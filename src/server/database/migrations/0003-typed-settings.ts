import "server-only";

import type { ClientSession, Connection } from "mongoose";

import {
  parseSettingsValues,
  settingsDefaults,
  settingsKind,
} from "../../../modules/settings/index.ts";

export const version = 3;
export const description =
  "Validate and explicitly upgrade legacy settings to typed singleton format";
export async function up(
  db: NonNullable<Connection["db"]>,
  session: ClientSession,
  now: Date,
): Promise<void> {
  const collection = db.collection("settings");
  const rows = await collection.find({ formatVersion: { $exists: false } }, { session }).toArray();
  for (const row of rows) {
    // Never silently discard legacy credentials or unknown configuration.
    if (row.encryptedPayload)
      throw new Error(
        "Legacy settings credentials require an explicit operator conversion before migration 3",
      );
    let kind, values;
    try {
      kind = settingsKind(row.kind);
      values = parseSettingsValues(kind, { ...settingsDefaults(kind), ...row.values });
      if (!Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error();
    } catch {
      throw new Error(
        "Legacy settings require operator review before migration 3; no values were logged or discarded",
      );
    }
    await collection.updateOne(
      { _id: row._id },
      {
        $set: {
          values,
          revision: row.revision + 1,
          formatVersion: 1,
          credentialConfigured: false,
          encryptionKeyId: null,
          encryptedAt: null,
          updatedAt: now,
        },
        $inc: { __v: 1 },
      },
      { session },
    );
  }
}
