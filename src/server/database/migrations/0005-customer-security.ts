import "server-only";

import type { ClientSession, Connection } from "mongoose";

import { isSupportedAdminPasswordHash } from "../../../modules/auth/server.ts";

export const version = 5;
export const description =
  "Validate password-backed customer identities and revoke legacy customer sessions";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession, now: Date) {
  const customers = db.collection("customers");
  for (const row of await customers.find({}, { session }).toArray()) {
    if (!isSupportedAdminPasswordHash(row.passwordHash))
      throw new Error(
        "Legacy customer identities require operator review before password login; no secrets are logged",
      );
    if (!Number.isSafeInteger(row.authVersion) || row.authVersion < 1)
      await customers.updateOne(
        { _id: row._id },
        { $set: { authVersion: 1, birthDate: row.birthDate ?? null, updatedAt: now } },
        { session },
      );
  }
  await db
    .collection("sessions")
    .updateMany(
      { principalKind: "customer", authVersion: { $exists: false } },
      { $set: { revokedAt: now } },
      { session },
    );
}
