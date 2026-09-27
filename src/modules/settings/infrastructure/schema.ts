import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import { nonNegativeIntegerField } from "../../../server/database/schema-fields.ts";
import { assertSafeRecord } from "../../../shared/safe-record.ts";

export const settingsSchema = new Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: ["business", "contact", "seo", "payment", "printing"],
    },
    revision: nonNegativeIntegerField(),
    values: { type: Map, of: Schema.Types.Mixed, default: {} },
    encryptedPayload: { type: String, select: false, default: null },
  },
  { ...documentSchemaOptions(true), collection: "settings" },
);
settingsSchema.index({ kind: 1 }, { unique: true, name: "settings_kind_unique" });
settingsSchema.pre("validate", function () {
  const values = this.get("values") as Map<string, unknown>;
  try {
    assertSafeRecord(Object.fromEntries(values ?? []));
  } catch (error) {
    this.invalidate("values", (error as Error).message);
  }
});
