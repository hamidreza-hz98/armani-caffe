import "server-only";

import type { ClientSession, Connection } from "mongoose";

export const version = 14;
export const description = "Remove customer password credentials for OTP authentication";

export async function up(db: NonNullable<Connection["db"]>, session: ClientSession) {
  await db.collection("customers").updateMany({}, { $unset: { passwordHash: "" } }, { session });
}
