import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, iranianMobileField } from "../../../server/database/conventions.ts";
import { requiredText } from "../../../server/database/schema-fields.ts";
import { adminRoles } from "../domain/model.ts";

export const adminSchema = new Schema(
  {
    phone: iranianMobileField(),
    displayName: requiredText(120),
    passwordHash: { ...requiredText(255), select: false },
    role: { type: String, required: true, enum: adminRoles },
    status: { type: String, required: true, enum: ["active", "disabled"], default: "active" },
    lastLoginAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(true), collection: "admins" },
);

adminSchema.index({ phone: 1 }, { unique: true, name: "admin_phone_unique" });
adminSchema.index({ role: 1, status: 1, createdAt: -1 }, { name: "admin_role_status_created" });
