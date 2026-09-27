import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, tomanAmountField } from "../../../server/database/conventions.ts";
import { objectIdField, requiredText } from "../../../server/database/schema-fields.ts";

export const transactionSchema = new Schema(
  {
    orderId: objectIdField(),
    provider: requiredText(60),
    amountToman: tomanAmountField(),
    status: {
      type: String,
      required: true,
      enum: ["created", "pending", "succeeded", "failed", "refunded"],
      default: "created",
    },
    idempotencyKey: requiredText(128),
    providerReference: { type: String, maxlength: 160, default: null },
    settledAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(true), collection: "transactions" },
);

transactionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "transaction_idempotency_unique" },
);
transactionSchema.index(
  { provider: 1, providerReference: 1 },
  {
    unique: true,
    partialFilterExpression: { providerReference: { $type: "string" } },
    name: "transaction_provider_reference_unique",
  },
);
transactionSchema.index({ orderId: 1, createdAt: -1 }, { name: "transaction_order_created" });
transactionSchema.index({ status: 1, createdAt: -1 }, { name: "transaction_status_created" });
transactionSchema.pre("validate", function () {
  if (["succeeded", "refunded"].includes(this.get("status") as string) && !this.get("settledAt")) {
    this.invalidate("settledAt", "Settled transaction needs a timestamp");
  }
});
