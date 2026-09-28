import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import {
  objectIdField,
  requiredText,
  utcDateField,
} from "../../../server/database/schema-fields.ts";

export const sessionSchema = new Schema(
  {
    principalKind: { type: String, required: true, enum: ["admin", "customer"] },
    principalId: objectIdField(),
    tokenHash: { ...requiredText(128), select: false },
    expiresAt: utcDateField(),
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    authVersion: {
      type: Number,
      default: null,
      min: 1,
      validate: (value: number | null) => value === null || Number.isSafeInteger(value),
      select: false,
    },
  },
  { ...documentSchemaOptions(), collection: "sessions" },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true, name: "session_token_hash_unique" });
sessionSchema.index(
  { principalKind: 1, principalId: 1, expiresAt: -1 },
  { name: "session_principal_expiry" },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "session_expiry_ttl" });

export const adminLoginThrottleSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    expiresAt: utcDateField(),
  },
  { ...documentSchemaOptions(), collection: "admin_login_throttles" },
);
adminLoginThrottleSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "admin_login_throttle_expiry" },
);

export const customerAuthThrottleSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    expiresAt: utcDateField(),
  },
  { ...documentSchemaOptions(), collection: "customer_auth_throttles" },
);
customerAuthThrottleSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "customer_auth_throttle_expiry" },
);
