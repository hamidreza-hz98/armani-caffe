import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, iranianMobileField } from "../../../server/database/conventions.ts";

export const customerSchema = new Schema(
  {
    phone: iranianMobileField(),
    displayName: { type: String, trim: true, maxlength: 120, default: null },
    status: { type: String, required: true, enum: ["active", "blocked"], default: "active" },
    lastOrderAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(true), collection: "customers" },
);

customerSchema.index({ phone: 1 }, { unique: true, name: "customer_phone_unique" });
customerSchema.index({ status: 1, createdAt: -1 }, { name: "customer_status_created" });
customerSchema.index(
  { displayName: "text" },
  { name: "customer_name_search", default_language: "none" },
);
