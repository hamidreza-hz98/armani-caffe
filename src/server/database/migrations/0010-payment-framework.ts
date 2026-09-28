import "server-only";

import type { ClientSession, Connection } from "mongoose";
export const version = 10;
export const description =
  "Require explicit legacy payment reconciliation before provider framework rollout";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession) {
  if (
    await db
      .collection("transactions")
      .findOne({ frameworkVersion: { $ne: 1 } }, { session, projection: { _id: 1 } })
  )
    throw new Error(
      "Legacy transactions require operator reconciliation; no gateway evidence was invented",
    );
}
