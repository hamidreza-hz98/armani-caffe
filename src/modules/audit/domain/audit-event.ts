import type { AuditActor } from "../../../shared/actor.ts";
import type { UtcTimestamp } from "../../../shared/domain.ts";

export type { AuditActor } from "../../../shared/actor.ts";
export type SensitiveArea =
  "admin" | "customer" | "payment" | "order" | "inventory" | "settings" | "print";

export type AuditEvent = Readonly<{
  id: string;
  occurredAt: UtcTimestamp;
  actor: AuditActor;
  area: SensitiveArea;
  action: string;
  subject: Readonly<{ kind: string; id: string }>;
  requestId: string;
  idempotencyKey: string;
  outcome: "success" | "failure";
  /** Only allowlisted, non-sensitive values belong in metadata. */
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type AuditDraft = Omit<AuditEvent, "id" | "occurredAt" | "outcome"> &
  Readonly<{ outcome?: "success" | "failure" }>;

export interface AuditEventWriter {
  append(event: AuditEvent): Promise<void>;
}
