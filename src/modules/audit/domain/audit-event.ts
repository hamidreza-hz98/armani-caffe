export type AuditActor = Readonly<{ kind: "admin" | "customer" | "system"; id: string | null }>;

export type AuditEvent = Readonly<{
  id: string;
  occurredAt: string;
  actor: AuditActor;
  action: string;
  subject: Readonly<{ kind: string; id: string }>;
  requestId: string;
  outcome: "success" | "failure";
  /** Only allowlisted, non-sensitive values belong in metadata. */
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export interface AuditEventWriter {
  append(event: AuditEvent): Promise<void>;
}
