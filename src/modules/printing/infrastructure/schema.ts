import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  objectIdField,
  requiredText,
} from "../../../server/database/schema-fields.ts";

export const printJobSchema = new Schema(
  {
    orderId: objectIdField(),
    printerId: requiredText(64),
    status: {
      type: String,
      required: true,
      enum: ["queued", "printing", "printed", "failed"],
      default: "queued",
    },
    attempts: nonNegativeIntegerField(),
    nextAttemptAt: { type: Date, default: null },
    printedAt: { type: Date, default: null },
    idempotencyKey: requiredText(128),
  },
  { ...documentSchemaOptions(true), collection: "print_jobs" },
);
printJobSchema.index({ idempotencyKey: 1 }, { unique: true, name: "print_job_idempotency_unique" });
printJobSchema.index({ status: 1, nextAttemptAt: 1 }, { name: "print_job_queue" });
printJobSchema.index({ orderId: 1, createdAt: -1 }, { name: "print_job_order_created" });
printJobSchema.pre("validate", function () {
  if (this.get("status") === "printed" && !this.get("printedAt")) {
    this.invalidate("printedAt", "Printed job needs a completion timestamp");
  }
});
