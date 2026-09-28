import "server-only";

import { Schema } from "mongoose";

import { addSoftDelete, documentSchemaOptions } from "../../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  objectIdField,
  requiredText,
} from "../../../../server/database/schema-fields.ts";

export const categorySchema = new Schema(
  {
    name: requiredText(120),
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[\p{Script=Arabic}a-z0-9]+(?:-[\p{Script=Arabic}a-z0-9]+)*$/u,
    },
    mediaId: { ...objectIdField(), required: false, default: null },
    sortOrder: nonNegativeIntegerField(),
    status: { type: String, required: true, enum: ["draft", "published"], default: "draft" },
  },
  { ...documentSchemaOptions(true), collection: "categories" },
);
addSoftDelete(categorySchema);

categorySchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: "category_active_slug_unique",
  },
);
categorySchema.index({ status: 1, sortOrder: 1, _id: 1 }, { name: "category_menu_order" });
categorySchema.index({ mediaId: 1, _id: 1 }, { name: "category_media_usage" });
categorySchema.index({ name: "text" }, { name: "category_name_search", default_language: "none" });

export const categoryOrderGuardSchema = new Schema(
  { _id: { type: String, required: true }, revision: nonNegativeIntegerField() },
  { ...documentSchemaOptions(), collection: "category_order_guard" },
);
