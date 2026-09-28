import "server-only";

import { createHash } from "node:crypto";

import { ApplicationError } from "../../../shared/errors.ts";
import type {
  PaymentProvider,
  ProviderRequest,
  VerificationResult,
} from "../application/provider.ts";
export type FakeRecord = {
  authority: string;
  paymentId: string;
  amountToman: number;
  outcome: VerificationResult;
};
export interface FakeLedger {
  put(record: FakeRecord): Promise<void>;
  get(authority: string): Promise<FakeRecord | null>;
  outcome(authority: string, result: VerificationResult): Promise<void>;
}
export class MemoryFakeLedger implements FakeLedger {
  private readonly records = new Map<string, FakeRecord>();
  async put(record: FakeRecord) {
    const old = this.records.get(record.authority);
    if (old && (old.paymentId !== record.paymentId || old.amountToman !== record.amountToman))
      throw new Error("Fake idempotency collision");
    if (!old) this.records.set(record.authority, structuredClone(record));
  }
  async get(authority: string) {
    return structuredClone(this.records.get(authority) ?? null);
  }
  async outcome(authority: string, result: VerificationResult) {
    const row = this.records.get(authority);
    if (!row) throw new Error("Unknown fake authority");
    this.records.set(authority, { ...row, outcome: structuredClone(result) });
  }
}
export class FakePaymentProvider implements PaymentProvider {
  readonly id = "fake";
  readonly idempotentCreate = true;
  readonly callbackMethods = ["GET"];
  readonly callbackFields = ["state", "authority", "result"];
  readonly redirectOrigins: string[];
  private readonly ledger: FakeLedger;
  constructor(ledger: FakeLedger, callbackOrigin: string) {
    this.ledger = ledger;
    this.redirectOrigins = [new URL(callbackOrigin).origin];
  }
  async create(request: ProviderRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    const authority =
      "fake_" +
      createHash("sha256")
        .update(request.paymentId + ":" + request.idempotencyKey)
        .digest("hex");
    await this.ledger.put({
      authority,
      paymentId: request.paymentId,
      amountToman: request.amountToman,
      outcome: { kind: "pending" },
    });
    const url = new URL(request.callbackUrl);
    url.searchParams.set("authority", authority);
    return { kind: "created" as const, authority, redirectUrl: url.href };
  }
  parseCallback(fields: Readonly<Record<string, string>>) {
    if (!fields.authority) throw new ApplicationError("VALIDATION", "Missing fake authority");
    return { authority: fields.authority };
  }
  async verify(request: ProviderRequest, signal: AbortSignal): Promise<VerificationResult> {
    signal.throwIfAborted();
    const row = request.authority ? await this.ledger.get(request.authority) : null;
    return row && row.paymentId === request.paymentId ? row.outcome : { kind: "unknown" };
  }
  inquire(request: ProviderRequest, signal: AbortSignal) {
    return this.verify(request, signal);
  }
}
