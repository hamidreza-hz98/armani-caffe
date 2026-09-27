import "server-only";

// Server public boundary. Compose use cases and adapters here.
import type { Connection } from "mongoose";

import type { AuditDraft } from "./domain/index.ts";
import { appendAudit } from "./infrastructure/repository.ts";

export { appendAudit } from "./infrastructure/repository.ts";
export { auditEventSchema } from "./infrastructure/schema.ts";

export async function recordRejectedSensitiveAction(
  connection: Connection,
  draft: AuditDraft,
  now: () => Date = () => new Date(),
): Promise<void> {
  await connection.transaction(
    (session) => appendAudit(connection, session, { ...draft, outcome: "failure" }, now()),
    { writeConcern: { w: "majority" } },
  );
}
