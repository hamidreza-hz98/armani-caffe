import "server-only";

import type { ClientSession, Connection } from "mongoose";

export const version = 13;
export const description = "Enable durable print jobs and receipt acknowledgements";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession) {
  await db
    .collection<{ _id: string; enabled: boolean }>("_app_metadata")
    .updateOne(
      { _id: "print-jobs-v2" },
      { $setOnInsert: { enabled: true } },
      { upsert: true, session },
    );
}
