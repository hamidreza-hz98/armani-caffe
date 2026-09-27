import "server-only";

import type { ClientSession, Connection } from "mongoose";

// A baseline receipt, not an application data migration.
export const version = 1;
export const description = "Record the initial schema baseline";

export async function up(
  db: NonNullable<Connection["db"]>,
  session: ClientSession,
  now: Date,
): Promise<void> {
  await db
    .collection<{ _id: string; initializedAt: Date }>("_app_metadata")
    .updateOne(
      { _id: "schema-baseline" },
      { $setOnInsert: { initializedAt: now } },
      { upsert: true, session },
    );
}
