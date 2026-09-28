import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import { nonNegativeIntegerField } from "../../../server/database/schema-fields.ts";
import { parseSettingsValues } from "../contracts/settings.ts";
import { settingsKinds } from "../domain/model.ts";

export const settingsSchema = new Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: settingsKinds,
    },
    revision: nonNegativeIntegerField(),
    values: { type: Map, of: Schema.Types.Mixed, default: {} },
    encryptedPayload: { type: String, select: false, default: null },
    formatVersion: { type: Number, required: true, enum: [1], default: 1 },
    credentialConfigured: { type: Boolean, default: false },
    encryptionKeyId: { type: String, default: null },
    encryptedAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(true), collection: "settings" },
);
settingsSchema.index({ kind: 1 }, { unique: true, name: "settings_kind_unique" });
settingsSchema.pre("validate", function () {
  const values = this.get("values") as Map<string, unknown>;
  try {
    parseSettingsValues(this.kind, Object.fromEntries(values ?? []));
  } catch (error) {
    this.invalidate("values", (error as Error).message);
  }
});

export const settingsReceiptSchema = new Schema(
  {
    actorId: { type: String, required: true },
    mutationKey: { type: String, required: true },
    fingerprint: { type: String, required: true, select: false },
    fingerprintKeyId: { type: String, required: true, select: false },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { ...documentSchemaOptions(), collection: "settings_receipts" },
);
settingsReceiptSchema.index(
  { actorId: 1, mutationKey: 1 },
  { unique: true, name: "settings_receipt_actor_key_unique" },
);
settingsReceiptSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60, name: "settings_receipt_expiry" },
);
