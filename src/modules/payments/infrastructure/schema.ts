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
    authority: { type: String, maxlength: 160, default: null },
    redirectUrl: { type: String, maxlength: 2048, default: null },
    frameworkVersion: { type: Number, enum: [0, 1], default: 0 },
    providerMode: { type: String, enum: ["sandbox", "production"], default: "sandbox" },
    encryptedCredential: { type: String, select: false, default: null },
    callbackKeyId: { type: String, select: false, default: null },
    callbackBaseUrl: { type: String, default: null },
    issue: {
      type: String,
      enum: [
        null,
        "AWAITING_PAYMENT",
        "AMBIGUOUS_VERIFICATION",
        "CREATION_AMBIGUOUS",
        "AMOUNT_MISMATCH",
        "AUTHORITY_MISMATCH",
        "REFERENCE_CONFLICT",
        "BUSY",
      ],
      default: null,
    },
    lockedUntil: { type: Date, default: null },
    claimToken: { type: String, select: false, default: null },
    creationAttempts: { type: Number, min: 0, default: 0 },
    verificationAttempts: { type: Number, min: 0, default: 0 },
    settledAt: { type: Date, default: null },
    confirmationGuard: { type: Number, min: 0, default: 0 },
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
transactionSchema.index(
  { provider: 1, authority: 1 },
  {
    unique: true,
    partialFilterExpression: { authority: { $type: "string" } },
    name: "transaction_provider_authority_unique",
  },
);
transactionSchema.index(
  { orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["created", "pending", "succeeded", "refunded"] } },
    name: "transaction_payable_order_unique",
  },
);
transactionSchema.index(
  { status: 1, lockedUntil: 1, updatedAt: 1 },
  { name: "transaction_reconciliation" },
);
transactionSchema.pre("validate", function () {
  if (["succeeded", "refunded"].includes(this.get("status") as string) && !this.get("settledAt")) {
    this.invalidate("settledAt", "Settled transaction needs a timestamp");
  }
});
