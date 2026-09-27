import "server-only";

import { Schema } from "mongoose";

import { normalizeIranianMobile } from "../../shared/phone.ts";

export function documentSchemaOptions(optimisticConcurrency = false) {
  return {
    timestamps: true,
    versionKey: "__v",
    optimisticConcurrency,
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
    strict: "throw" as const,
  };
}

export function tomanAmountField() {
  return {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (value: number) => Number.isSafeInteger(value),
      message: "Money must be a safe integer number of toman",
    },
  };
}

export function iranianMobileField() {
  return { type: String, required: true, set: normalizeIranianMobile };
}

// Opt in only for records whose business history requires a tombstone.
export function addSoftDelete(schema: Schema): void {
  schema.add({ deletedAt: { type: Date, default: null } });
}
