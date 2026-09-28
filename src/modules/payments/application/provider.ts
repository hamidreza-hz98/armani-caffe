import { ApplicationError } from "../../../shared/errors.ts";

export type ProviderConfiguration = {
  id: string;
  mode: "sandbox" | "production";
  credential?: string;
};
export type ProviderRequest = {
  paymentId: string;
  idempotencyKey: string;
  amountToman: number;
  callbackUrl: string;
  authority: string | null;
};
export type CreationResult =
  | { kind: "created"; authority: string; redirectUrl: string }
  | { kind: "rejected" }
  | { kind: "unknown" };
export type VerificationResult =
  | {
      kind: "succeeded";
      authority: string;
      reference: string;
      amountToman: number;
      currency: "TOMAN";
    }
  | { kind: "failed"; authority: string }
  | { kind: "pending" }
  | { kind: "unknown" };
export interface PaymentProvider {
  readonly id: string;
  /** Only true with a documented remote idempotency guarantee. */
  readonly idempotentCreate: boolean;
  readonly callbackMethods: readonly string[];
  readonly callbackFields: readonly string[];
  readonly redirectOrigins: readonly string[];
  create(request: ProviderRequest, signal: AbortSignal): Promise<CreationResult>;
  parseCallback(fields: Readonly<Record<string, string>>): { authority: string };
  verify(request: ProviderRequest, signal: AbortSignal): Promise<VerificationResult>;
  inquire(request: ProviderRequest, signal: AbortSignal): Promise<VerificationResult>;
  refund?(
    request: ProviderRequest & { reference: string },
    signal: AbortSignal,
  ): Promise<{ kind: "refunded" | "unknown" }>;
}
export type ProviderFactory = (configuration: ProviderConfiguration) => PaymentProvider;
export class ProviderRegistry {
  private readonly factories: ReadonlyMap<string, ProviderFactory>;
  constructor(factories: ReadonlyMap<string, ProviderFactory>) {
    this.factories = factories;
  }
  get(configuration: ProviderConfiguration) {
    const factory = this.factories.get(configuration.id);
    if (!factory)
      throw new ApplicationError("UNAVAILABLE", "Payment provider adapter is not registered");
    try {
      const adapter = factory(configuration);
      if (adapter.id !== configuration.id) throw new Error();
      return adapter;
    } catch {
      throw new ApplicationError("UNAVAILABLE", "Payment provider configuration rejected");
    }
  }
}
