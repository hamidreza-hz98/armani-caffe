import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, iranianMobileField } from "../../../server/database/conventions.ts";

export const customerSchema = new Schema(
  {
    phone: iranianMobileField(),
    displayName: { type: String, trim: true, maxlength: 120, default: null },
    passwordHash: { type: String, required: true, maxlength: 255, select: false },
    birthDate: {
      type: Date,
      default: null,
      validate: (value: Date | null) =>
        value === null ||
        (value instanceof Date &&
          Number.isFinite(value.getTime()) &&
          value.toISOString().endsWith("T00:00:00.000Z")),
    },
    authVersion: { type: Number, required: true, min: 1, default: 1, select: false },
    status: {
      type: String,
      required: true,
      enum: ["active", "blocked", "anonymized"],
      default: "active",
    },
    anonymizedAt: { type: Date, default: null },
    lastOrderAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(true), collection: "customers" },
);

customerSchema.index({ phone: 1 }, { unique: true, name: "customer_phone_unique" });
customerSchema.index({ status: 1, createdAt: -1 }, { name: "customer_status_created" });
customerSchema.index({ createdAt: -1, _id: -1 }, { name: "customer_recent" });
customerSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: "customer_status_recent" });
customerSchema.index(
  { displayName: "text" },
  { name: "customer_name_search", default_language: "none" },
);
