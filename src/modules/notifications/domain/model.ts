import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

export type OutboxStatus = "pending" | "processing" | "delivered" | "dead";
export type OutboxEvent = EntityDto &
  Readonly<{
    aggregateKind: string;
    aggregateId: string;
    eventType: string;
    payload: Readonly<Record<string, string | number | boolean | null>>;
    status: OutboxStatus;
    attempts: number;
    availableAt: UtcTimestamp;
    lockedUntil: UtcTimestamp | null;
    deliveredAt: UtcTimestamp | null;
    idempotencyKey: string;
  }>;

const allowed: Record<OutboxStatus, readonly OutboxStatus[]> = {
  pending: ["processing", "dead"],
  processing: ["pending", "delivered", "dead"],
  delivered: [],
  dead: [],
};
export function assertOutboxTransition(from: OutboxStatus, to: OutboxStatus): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid outbox transition: ${from} -> ${to}`);
}
