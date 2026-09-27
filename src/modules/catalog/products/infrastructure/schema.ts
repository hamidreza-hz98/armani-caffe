import "server-only";

import { Schema } from "mongoose";

import {
  addSoftDelete,
  documentSchemaOptions,
  tomanAmountField,
} from "../../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  objectIdField,
  requiredText,
} from "../../../../server/database/schema-fields.ts";

export const productSchema = new Schema(
  {
    categoryId: objectIdField(),
    name: requiredText(160),
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    basePriceToman: tomanAmountField(),
    mediaIds: { type: [Schema.Types.ObjectId], default: [] },
    status: {
      type: String,
      required: true,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    available: { type: Boolean, required: true, default: true },
    sortOrder: nonNegativeIntegerField(),
  },
  { ...documentSchemaOptions(true), collection: "products" },
);
addSoftDelete(productSchema);
productSchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: "product_active_slug_unique",
  },
);
productSchema.index(
  { categoryId: 1, status: 1, available: 1, sortOrder: 1 },
  { name: "product_category_menu" },
);
productSchema.index({ status: 1, updatedAt: -1 }, { name: "product_status_updated" });
productSchema.index(
  { name: "text", description: "text" },
  { name: "product_text_search", default_language: "none" },
);

export const productAdditionSchema = new Schema(
  {
    productId: objectIdField(),
    name: requiredText(120),
    priceToman: tomanAmountField(),
    available: { type: Boolean, required: true, default: true },
    sortOrder: nonNegativeIntegerField(),
  },
  { ...documentSchemaOptions(true), collection: "product_additions" },
);
productAdditionSchema.index(
  { productId: 1, name: 1 },
  { unique: true, name: "addition_product_name_unique" },
);
productAdditionSchema.index(
  { productId: 1, available: 1, sortOrder: 1 },
  { name: "addition_product_menu" },
);
