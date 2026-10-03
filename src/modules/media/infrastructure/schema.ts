import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  objectIdField,
  positiveIntegerField,
  requiredText,
} from "../../../server/database/schema-fields.ts";

const variantSchema = new Schema(
  {
    key: requiredText(512),
    variant: { type: String, required: true, enum: ["original", "small", "large"] },
    byteSize: nonNegativeIntegerField(),
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    mimeType: { type: String, required: true, enum: ["image/webp"] },
    width: positiveIntegerField(),
    height: positiveIntegerField(),
  },
  { _id: false, strict: "throw" },
);

export const mediaAssetSchema = new Schema(
  {
    objectKey: { type: String, default: null, maxlength: 512 },
    bucket: requiredText(63),
    mimeType: requiredText(100),
    byteSize: nonNegativeIntegerField(),
    sha256: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
    filename: requiredText(180),
    objectVersion: requiredText(36),
    title: requiredText(120),
    altText: { type: String, maxlength: 200, default: "" },
    caption: { type: String, maxlength: 500, default: "" },
    seo: {
      title: { type: String, maxlength: 150, default: "" },
      description: { type: String, maxlength: 300, default: "" },
      keywords: { type: [String], default: [] },
    },
    visibility: { type: String, enum: ["private", "public"], default: "private", required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    variants: { type: [variantSchema], default: [] },
    uploaderId: objectIdField(),
    initiationKey: requiredText(128),
    fingerprint: requiredText(64),
    ticketCiphertext: { type: String, select: false, required: true },
    stagingKey: { ...requiredText(512), select: false },
    expiresAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    leaseToken: { type: String, default: null, select: false },
    referenceGuard: { ...nonNegativeIntegerField(), default: 0 },
    legacyReviewRequired: { type: Boolean, default: false },
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
mediaAssetSchema.index(
  { uploaderId: 1, initiationKey: 1 },
  { unique: true, name: "media_initiation_unique" },
);
mediaAssetSchema.index(
  { status: 1, expiresAt: 1, lockedUntil: 1 },
  { name: "media_expired_uploads" },
);
for (const field of ["createdAt", "updatedAt", "title", "byteSize"] as const) {
  mediaAssetSchema.index(
    { status: 1, visibility: 1, [field]: 1, _id: 1 },
    { name: `media_browse_${field}` },
  );
  mediaAssetSchema.index({ status: 1, [field]: 1, _id: 1 }, { name: `media_admin_${field}` });
}
mediaAssetSchema.index(
  { status: 1, visibility: 1, mimeType: 1, createdAt: -1 },
  { name: "media_type_browse" },
);
mediaAssetSchema.index(
  { filename: "text", title: "text", altText: "text", caption: "text" },
  { name: "media_search", default_language: "none" },
);
mediaAssetSchema.index({ ownerId: 1, createdAt: -1 }, { name: "media_owner_created" });
mediaAssetSchema.index({ status: 1, createdAt: -1 }, { name: "media_status_created" });
mediaAssetSchema.pre("validate", function () {
  if (this.get("status") === "deleted" && !this.get("deletedAt")) {
    this.invalidate("deletedAt", "Deleted media needs a deletion timestamp");
  }
});

export const mediaReferenceSchema = new Schema(
  {
    mediaId: objectIdField(),
    entityKind: { type: String, required: true, enum: ["product", "category", "settings"] },
    entityId: objectIdField(),
    field: {
      type: String,
      required: true,
      enum: ["mediaIds", "mediaId", "additionMediaIds", "logoMediaId", "faviconMediaId"],
    },
  },
  { ...documentSchemaOptions(), collection: "media_references" },
);
mediaReferenceSchema.index(
  { entityKind: 1, entityId: 1, field: 1, mediaId: 1 },
  { unique: true, name: "media_reference_unique" },
);
mediaReferenceSchema.index({ mediaId: 1, entityKind: 1, entityId: 1 }, { name: "media_usage" });

export const mediaCleanupSchema = new Schema(
  {
    ownerId: objectIdField(),
    assetId: objectIdField(),
    outputId: requiredText(36),
    stagingKey: { type: String, default: null },
    removeOutputs: { type: Boolean, required: true },
    status: { type: String, enum: ["pending", "processing", "done"], default: "pending" },
    availableAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    leaseToken: { type: String, default: null },
    attempts: { ...nonNegativeIntegerField(), default: 0 },
    completedAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(), collection: "media_cleanup" },
);
mediaCleanupSchema.index(
  { status: 1, availableAt: 1, lockedUntil: 1 },
  { name: "media_cleanup_claim" },
);
mediaCleanupSchema.index(
  { completedAt: 1 },
  {
    name: "media_cleanup_ttl",
    expireAfterSeconds: 30 * 86400,
    partialFilterExpression: { status: "done" },
  },
);

export const mediaReceiptSchema = new Schema(
  {
    scope: requiredText(24),
    key: requiredText(128),
    fingerprint: requiredText(64),
    result: { type: Schema.Types.Mixed, required: true },
  },
  { ...documentSchemaOptions(), collection: "media_receipts" },
);
mediaReceiptSchema.index({ scope: 1, key: 1 }, { unique: true, name: "media_receipt_unique" });
