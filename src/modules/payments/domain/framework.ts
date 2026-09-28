import { ApplicationError } from "../../../shared/errors.ts";
import type { TransactionStatus } from "./model.ts";
export type PaymentIssue =
  | "AWAITING_PAYMENT"
  | "AMBIGUOUS_VERIFICATION"
  | "CREATION_AMBIGUOUS"
  | "AMOUNT_MISMATCH"
  | "AUTHORITY_MISMATCH"
  | "REFERENCE_CONFLICT"
  | "BUSY"
  | null;
export type PaymentView = {
  id: string;
  orderId: string;
  provider: string;
  amountToman: number;
  status: TransactionStatus;
  authority: string | null;
  reference: string | null;
  redirectUrl: string | null;
  issue: PaymentIssue;
  revision: number;
};
export function paymentIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/u.test(value))
    throw new ApplicationError("VALIDATION", "Invalid payment identifier");
  return value;
}
export function paymentKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z\d_-]{8,128}$/u.test(value))
    throw new ApplicationError("VALIDATION", "Invalid payment idempotency key");
  return value;
}
export function validProviderValue(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z\d_:-]{1,160}$/u.test(value);
}
export type ProviderChoice = {
  id: string;
  enabled: boolean;
  priority: number;
  mode: "sandbox" | "production";
  credential?: string;
};
export function selectProvider(
  choices: readonly ProviderChoice[],
  defaultId: string | null,
  production: boolean,
) {
  const enabled = choices.filter((c) => c.enabled && !(production && c.id === "fake"));
  const selected = defaultId
    ? enabled.find((c) => c.id === defaultId)
    : [...enabled].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
  if (!selected) throw new ApplicationError("UNAVAILABLE", "No eligible payment provider");
  return selected;
}
