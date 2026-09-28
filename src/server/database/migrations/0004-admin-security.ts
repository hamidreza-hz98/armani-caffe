import "server-only";

import type { ClientSession, Connection } from "mongoose";

import { isSupportedAdminPasswordHash } from "../../../modules/auth/server.ts";

export const version = 4;
export const description = "Initialize owner invariant guard and revoke legacy admin sessions";
export async function up(
  db: NonNullable<Connection["db"]>,
  session: ClientSession,
  now: Date,
): Promise<void> {
  const admins = db.collection("admins");
  for (const row of await admins.find({ authVersion: { $exists: false } }, { session }).toArray()) {
    if (!isSupportedAdminPasswordHash(row.passwordHash))
      throw new Error(
        "Legacy admin password hashes need explicit operator review before migration 4; no hashes or passwords are logged",
      );
    await admins.updateOne(
      { _id: row._id },
      {
        $set: {
          username: row.username ?? `admin.${row._id}`,
          authVersion: 1,
          authorizationGuard: 0,
          deletedAt: null,
          updatedAt: now,
        },
      },
      { session },
    );
  }
  if (
    (await admins.countDocuments({}, { session })) > 0 &&
    (await admins.countDocuments(
      { role: "OWNER", status: "active", deletedAt: null },
      { session },
    )) === 0
  )
    throw new Error("Admin migration requires an active owner; operator review required");
  await db
    .collection("sessions")
    .updateMany(
      { principalKind: "admin", authVersion: { $exists: false } },
      { $set: { revokedAt: now } },
      { session },
    );
  await db
    .collection<{ _id: string; revision: number }>("admin_owner_guard")
    .updateOne(
      { _id: "active-owners" },
      { $setOnInsert: { revision: 0 } },
      { upsert: true, session },
    );
}
