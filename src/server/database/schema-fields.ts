import "server-only";

import { Schema } from "mongoose";

export function objectIdField(required = true) {
  return { type: Schema.Types.ObjectId, required };
}

export function nonNegativeIntegerField(required = true) {
  return { type: Number, required, min: 0, validate: Number.isSafeInteger };
}

export function positiveIntegerField() {
  return { type: Number, required: true, min: 1, validate: Number.isSafeInteger };
}

export function signedIntegerField() {
  return {
    type: Number,
    required: true,
    validate: (value: number) => Number.isSafeInteger(value) && value !== 0,
  };
}

export function requiredText(maxlength = 200) {
  return { type: String, required: true, trim: true, minlength: 1, maxlength };
}

export function utcDateField(required = true) {
  return { type: Date, required };
}
