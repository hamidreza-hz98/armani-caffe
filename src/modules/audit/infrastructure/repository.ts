import "server-only";

import type { ClientSession, Connection } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
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
  // Append-only batches need validation/casting, not save-document rollback tracking.
  try {
    await auditModel(connection).insertMany(
      [{ ...draft, outcome: draft.outcome ?? "success", occurredAt: now }],
      { session, ordered: true },
    );
  } catch (error) {
    // Preserve driver's retry signal so the outer transaction can retry safely.
    if (
      error &&
      typeof error === "object" &&
      "hasErrorLabel" in error &&
      typeof error.hasErrorLabel === "function" &&
      error.hasErrorLabel("TransientTransactionError")
    )
      throw error;
    // Audit failure is infrastructure failure, not a caller's domain uniqueness conflict.
    // Do not expose driver diagnostics, which may contain sensitive documents.
    throw new ApplicationError("UNAVAILABLE", "Required audit append failed");
  }
}
