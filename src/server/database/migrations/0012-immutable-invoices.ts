import "server-only";

import type { ClientSession, Connection } from "mongoose";
export const version = 12;
export const description =
  "Enable atomic invoice v2 snapshots without rewriting historical receipts";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession) {
  // Original settings cannot be reconstructed from mutable current settings.
  await db
    .collection<{ _id: string; enabled: boolean }>("_app_metadata")
    .updateOne(
      { _id: "invoice-v2" },
      { $setOnInsert: { enabled: true } },
      { upsert: true, session },
    );
}
