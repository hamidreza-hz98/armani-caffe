import type { EntityDto, TomanAmount, UtcTimestamp } from "../../../shared/domain.ts";

export type TransactionStatus = "created" | "pending" | "succeeded" | "failed" | "refunded";
export type Transaction = EntityDto &
  Readonly<{
    orderId: string;
    provider: string;
    amountToman: TomanAmount;
    status: TransactionStatus;
    idempotencyKey: string;
    providerReference: string | null;
    settledAt: UtcTimestamp | null;
  }>;

const allowed: Record<TransactionStatus, readonly TransactionStatus[]> = {
  created: ["pending", "failed"],
  pending: ["succeeded", "failed"],
  succeeded: ["refunded"],
  failed: [],
  refunded: [],
};
export function assertTransactionTransition(from: TransactionStatus, to: TransactionStatus): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid transaction transition: ${from} -> ${to}`);
}
