import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, iranianMobileField } from "../../../server/database/conventions.ts";
import { requiredText } from "../../../server/database/schema-fields.ts";
import { adminRoles } from "../domain/model.ts";

export const adminSchema = new Schema(
  {
    username: { ...requiredText(40), lowercase: true, match: /^[a-z][a-z0-9._-]{2,39}$/ },
    phone: iranianMobileField(),
    displayName: requiredText(120),
    passwordHash: { ...requiredText(255), select: false },
    role: { type: String, required: true, enum: adminRoles },
    status: { type: String, required: true, enum: ["active", "disabled"], default: "active" },
    lastLoginAt: { type: Date, default: null },
    authVersion: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      validate: Number.isSafeInteger,
      select: false,
    },
    authorizationGuard: { type: Number, default: 0, select: false },
    deletedAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(true), collection: "admins" },
);

adminSchema.index({ phone: 1 }, { unique: true, name: "admin_phone_unique" });
adminSchema.index(
  { username: 1 },
  {
    unique: true,
    partialFilterExpression: { username: { $type: "string" } },
    name: "admin_username_unique",
  },
);
adminSchema.index({ role: 1, status: 1, createdAt: -1 }, { name: "admin_role_status_created" });

export const adminOwnerGuardSchema = new Schema(
  { _id: { type: String, required: true }, revision: { type: Number, default: 0 } },
  { ...documentSchemaOptions(), collection: "admin_owner_guard" },
);
