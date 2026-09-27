import "server-only";

import type { ClientSession, Connection } from "mongoose";

import type { AuditDraft } from "../domain/index.ts";
import { auditEventSchema } from "./schema.ts";

function auditModel(connection: Connection) {
  return connection.models.AuditEvent ?? connection.model("AuditEvent", auditEventSchema);
}

export async function appendAudit(
  connection: Connection,
  session: ClientSession,
  draft: AuditDraft,
  now: Date,
): Promise<void> {
  await auditModel(connection).create(
    [{ ...draft, outcome: draft.outcome ?? "success", occurredAt: now }],
    { session },
  );
}
