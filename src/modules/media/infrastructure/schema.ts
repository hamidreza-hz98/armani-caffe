import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  objectIdField,
  requiredText,
} from "../../../server/database/schema-fields.ts";

export const mediaAssetSchema = new Schema(
  {
    objectKey: requiredText(512),
    bucket: requiredText(63),
    mimeType: requiredText(100),
    byteSize: nonNegativeIntegerField(),
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    status: {
      type: String,
      required: true,
      enum: ["pending", "ready", "rejected", "deleted"],
      default: "pending",
    },
    ownerId: objectIdField(),
    deletedAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(), collection: "media_assets" },
);

mediaAssetSchema.index({ objectKey: 1 }, { unique: true, name: "media_object_key_unique" });
mediaAssetSchema.index({ ownerId: 1, createdAt: -1 }, { name: "media_owner_created" });
mediaAssetSchema.index({ status: 1, createdAt: -1 }, { name: "media_status_created" });
mediaAssetSchema.pre("validate", function () {
  if (this.get("status") === "deleted" && !this.get("deletedAt")) {
    this.invalidate("deletedAt", "Deleted media needs a deletion timestamp");
  }
});
