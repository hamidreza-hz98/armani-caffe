import "server-only";

// Server public boundary. Compose use cases and adapters here.
import type { ClientSession, Connection } from "mongoose";

import type { AuditDraft } from "../audit/index.ts";
import { appendAudit } from "../audit/server.ts";
import type { OutboxDraft } from "./domain/model.ts";
import { appendOutbox } from "./infrastructure/repository.ts";

export { outboxModel, replayOutbox } from "./infrastructure/repository.ts";
export { appendOutbox } from "./infrastructure/repository.ts";
export { outboxEventSchema } from "./infrastructure/schema.ts";
export { OutboxWorker } from "./infrastructure/worker.ts";

export type SensitiveChange<T> = Readonly<{
  audit: AuditDraft;
  events: readonly [OutboxDraft, ...OutboxDraft[]];
  change: (session: ClientSession) => Promise<T>;
}>;

export async function commitSensitiveChange<T>(
  connection: Connection,
  input: SensitiveChange<T>,
  now: () => Date = () => new Date(),
): Promise<T> {
  if (!input.audit || !input.events?.length || !input.change) {
    throw new RangeError("A sensitive change needs an audit record and at least one outbox event");
  }
  if (input.audit.outcome === "failure") {
    throw new RangeError("A committed change cannot carry a failure audit outcome");
  }
  if (
    input.events.some(
      (event) =>
        event.requestId !== input.audit.requestId ||
        event.actor.kind !== input.audit.actor.kind ||
        event.actor.id !== input.audit.actor.id,
    )
  ) {
    throw new RangeError("Audit and outbox correlation and actor must match");
  }
  return connection.transaction(
    async (session) => {
      const result = await input.change(session);
      const timestamp = now();
      await appendOutbox(connection, session, input.events, timestamp);
      await appendAudit(connection, session, input.audit, timestamp);
      return result;
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
}
