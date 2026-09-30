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
    invoiceId: objectIdField(),
    source: { type: String, required: true, enum: ["automatic", "reprint"] },
    reprintId: objectIdField(false),
    printerId: requiredText(64),
    paperWidthMm: { type: Number, required: true, enum: [58, 80] },
    status: {
      type: String,
      required: true,
      enum: ["queued", "printing", "printed", "dead"],
      default: "queued",
    },
    attempts: nonNegativeIntegerField(),
    nextAttemptAt: { type: Date, default: null },
    printedAt: { type: Date, default: null },
    leaseUntil: { type: Date, default: null },
    deliveryId: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
    lastFailureCode: { type: String, default: null },
    maxAttempts: { type: Number, required: true, default: 5 },
    idempotencyKey: requiredText(128),
  },
  { ...documentSchemaOptions(true), collection: "print_jobs" },
);
printJobSchema.index({ idempotencyKey: 1 }, { unique: true, name: "print_job_idempotency_unique" });
printJobSchema.index({ status: 1, nextAttemptAt: 1 }, { name: "print_job_queue" });
printJobSchema.index({ orderId: 1, createdAt: -1 }, { name: "print_job_order_created" });
printJobSchema.index({ invoiceId: 1, createdAt: -1 }, { name: "print_job_invoice_created" });
printJobSchema.index({ status: 1, leaseUntil: 1 }, { name: "print_job_expired_lease" });
printJobSchema.pre("validate", function () {
  if (this.get("status") === "printed" && !this.get("printedAt")) {
    this.invalidate("printedAt", "Printed job needs a completion timestamp");
  }
});
