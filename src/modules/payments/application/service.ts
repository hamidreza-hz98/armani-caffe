import { ApplicationError } from "../../../shared/errors.ts";
import {
  paymentIdentifier,
  type PaymentIssue,
  paymentKey,
  type PaymentView,
  validProviderValue,
} from "../domain/framework.ts";
import type { TransactionStatus } from "../domain/model.ts";
import {
  type CreationResult,
  type PaymentProvider,
  type ProviderConfiguration,
  ProviderRegistry,
  type ProviderRequest,
  type VerificationResult,
} from "./provider.ts";

export type PaymentWork = {
  view: PaymentView;
  configuration: ProviderConfiguration;
  request: ProviderRequest;
  claim: string | null;
  creationAttempts: number;
};
export interface PaymentRepository {
  reserve(orderId: string, key: string, requestId: string): Promise<PaymentView>;
  inspect(id: string): Promise<PaymentWork>;
  claim(id: string, operation: "create" | "verify", requestId: string): Promise<PaymentWork>;
  callbackValid(work: PaymentWork, url: URL, state: string): boolean;
  complete(
    work: PaymentWork,
    change: {
      status?: TransactionStatus;
      authority?: string;
      redirectUrl?: string;
      reference?: string;
      issue: PaymentIssue;
    },
    requestId: string,
  ): Promise<PaymentView>;
}
async function bounded<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Provider deadline exceeded"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class PaymentService {
  private readonly repository: PaymentRepository;
  private readonly registry: ProviderRegistry;
  private readonly timeoutMs: number;
  constructor(repository: PaymentRepository, registry: ProviderRegistry, timeoutMs = 5000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
      throw new RangeError("Invalid payment timeout");
    this.repository = repository;
    this.registry = registry;
    this.timeoutMs = timeoutMs;
  }
  /** Trusted checkout-only API. No amount, provider credentials, or callback URL input. */
  async create(orderId: unknown, key: unknown, requestId: string) {
    const view = await this.repository.reserve(
      paymentIdentifier(orderId),
      paymentKey(key),
      requestId,
    );
    if (view.status !== "created") return view;
    const work = await this.repository.claim(view.id, "create", requestId);
    if (!work.claim)
      return {
        ...work.view,
        issue: work.view.status === "created" ? ("BUSY" as const) : work.view.issue,
      };
    const adapter = this.registry.get(work.configuration);
    if (work.creationAttempts > 1 && !adapter.idempotentCreate)
      return this.repository.complete(work, { issue: "CREATION_AMBIGUOUS" }, requestId);
    let result: CreationResult;
    try {
      result = await bounded(this.timeoutMs, (signal) => adapter.create(work.request, signal));
    } catch {
      result = { kind: "unknown" };
    }
    if (result.kind === "rejected")
      return this.repository.complete(work, { status: "failed", issue: null }, requestId);
    if (result.kind !== "created" || !validProviderValue(result.authority))
      return this.repository.complete(work, { issue: "CREATION_AMBIGUOUS" }, requestId);
    let redirect: URL;
    try {
      redirect = new URL(result.redirectUrl);
    } catch {
      return this.repository.complete(work, { issue: "CREATION_AMBIGUOUS" }, requestId);
    }
    if (
      !adapter.redirectOrigins.includes(redirect.origin) ||
      !["http:", "https:"].includes(redirect.protocol) ||
      redirect.username ||
      redirect.password ||
      redirect.hash
    )
      return this.repository.complete(work, { issue: "CREATION_AMBIGUOUS" }, requestId);
    return this.repository.complete(
      work,
      {
        status: "pending",
        authority: result.authority,
        redirectUrl: redirect.href,
        issue: "AWAITING_PAYMENT",
      },
      requestId,
    );
  }
  async callback(
    id: unknown,
    provider: string,
    method: string,
    url: URL,
    fields: Readonly<Record<string, string>>,
    requestId: string,
  ) {
    const work = await this.repository.inspect(paymentIdentifier(id));
    if (work.view.provider !== provider)
      throw new ApplicationError("VALIDATION", "Payment callback provider mismatch");
    const adapter = this.registry.get(work.configuration);
    if (
      !adapter.callbackMethods.includes(method) ||
      Object.keys(fields).some((key) => !adapter.callbackFields.includes(key)) ||
      !this.repository.callbackValid(work, url, fields.state ?? "")
    )
      throw new ApplicationError("FORBIDDEN", "Payment callback is not allowlisted");
    let parsed: { authority: string };
    try {
      parsed = adapter.parseCallback(fields);
    } catch {
      throw new ApplicationError("VALIDATION", "Payment callback parsing rejected");
    }
    if (!validProviderValue(parsed.authority) || parsed.authority !== work.view.authority)
      throw new ApplicationError("VALIDATION", "Payment callback authority mismatch");
    return this.verify(work.view.id, requestId, false);
  }
  /** Trusted worker/operator entrypoint, not an unauthenticated HTTP inquiry endpoint. */
  async inquire(id: unknown, requestId: string) {
    return this.verify(paymentIdentifier(id), requestId, true);
  }
  private async verify(id: string, requestId: string, inquiry: boolean) {
    const work = await this.repository.claim(id, "verify", requestId);
    if (!work.claim)
      return {
        ...work.view,
        issue: work.view.status === "pending" ? ("BUSY" as const) : work.view.issue,
      };
    const adapter: PaymentProvider = this.registry.get(work.configuration);
    let result: VerificationResult;
    try {
      result = await bounded(this.timeoutMs, (signal) =>
        inquiry ? adapter.inquire(work.request, signal) : adapter.verify(work.request, signal),
      );
    } catch {
      result = { kind: "unknown" };
    }
    if (result.kind === "pending")
      return this.repository.complete(work, { issue: "AWAITING_PAYMENT" }, requestId);
    if (result.kind === "unknown")
      return this.repository.complete(work, { issue: "AMBIGUOUS_VERIFICATION" }, requestId);
    if (result.kind !== "succeeded" && result.kind !== "failed")
      return this.repository.complete(work, { issue: "AMBIGUOUS_VERIFICATION" }, requestId);
    if (result.authority !== work.view.authority)
      return this.repository.complete(work, { issue: "AUTHORITY_MISMATCH" }, requestId);
    if (result.kind === "failed")
      return this.repository.complete(work, { status: "failed", issue: null }, requestId);
    if (
      result.currency !== "TOMAN" ||
      !Number.isSafeInteger(result.amountToman) ||
      result.amountToman !== work.view.amountToman
    )
      return this.repository.complete(work, { issue: "AMOUNT_MISMATCH" }, requestId);
    if (!validProviderValue(result.reference))
      return this.repository.complete(work, { issue: "AMBIGUOUS_VERIFICATION" }, requestId);
    return this.repository.complete(
      work,
      { status: "succeeded", reference: result.reference, issue: null },
      requestId,
    );
  }
}
