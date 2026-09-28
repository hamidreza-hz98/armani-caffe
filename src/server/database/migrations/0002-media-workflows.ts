import "server-only";

import { randomUUID } from "node:crypto";

import type { ClientSession, Connection } from "mongoose";

export const version = 2;
export const description = "Quarantine legacy media for explicit metadata/storage review";
export async function up(
  db: NonNullable<Connection["db"]>,
  session: ClientSession,
  now: Date,
): Promise<void> {
  const collection = db.collection("media_assets");
  const rows = await collection.find({ initiationKey: { $exists: false } }, { session }).toArray();
  for (const row of rows) {
    await collection.updateOne(
      { _id: row._id },
      {
        $set: {
          filename: "legacy-image",
          title: "رسانهٔ قدیمی",
          altText: "",
          caption: "",
          seo: { title: "", description: "", keywords: [] },
          objectVersion: randomUUID(),
          visibility: "private",
          width: null,
          height: null,
          variants: [],
          uploaderId: row.ownerId,
          initiationKey: `legacy_${row._id}`,
          fingerprint: "0".repeat(64),
          ticketCiphertext: "legacy-unavailable",
          stagingKey: row.objectKey ?? "legacy-unavailable",
          expiresAt: now,
          lockedUntil: null,
          leaseToken: null,
          referenceGuard: 0,
          legacyReviewRequired: true,
          status: row.status === "deleted" ? "deleted" : "rejected",
          updatedAt: now,
        },
      },
      { session },
    );
  }
}
