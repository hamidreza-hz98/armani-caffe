import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  objectIdField,
  positiveIntegerField,
  requiredText,
  signedIntegerField,
} from "../../../server/database/schema-fields.ts";

export const inventoryItemSchema = new Schema(
  {
    name: requiredText(160),
    unit: { type: String, required: true, enum: ["gram", "milliliter", "piece"] },
    onHand: nonNegativeIntegerField(),
    reorderLevel: nonNegativeIntegerField(),
    status: { type: String, required: true, enum: ["active", "archived"], default: "active" },
  },
  { ...documentSchemaOptions(true), collection: "inventory_items" },
);
inventoryItemSchema.index({ name: 1 }, { unique: true, name: "inventory_name_unique" });
inventoryItemSchema.index({ status: 1, updatedAt: -1 }, { name: "inventory_status_updated" });
inventoryItemSchema.index(
  { status: 1, onHand: 1, _id: 1 },
  { name: "inventory_low_stock_dashboard" },
);
inventoryItemSchema.index(
  { name: "text" },
  { name: "inventory_name_search", default_language: "none" },
);

export const productConsumptionRuleSchema = new Schema(
  {
    productId: objectIdField(),
    inventoryItemId: objectIdField(),
    quantityPerUnit: positiveIntegerField(),
    active: { type: Boolean, required: true, default: true },
  },
  { ...documentSchemaOptions(true), collection: "product_consumption_rules" },
);
productConsumptionRuleSchema.index(
  { productId: 1, inventoryItemId: 1 },
  { unique: true, name: "consumption_product_item_unique" },
);
productConsumptionRuleSchema.index(
  { inventoryItemId: 1, active: 1 },
  { name: "consumption_item_active" },
);

export const inventoryMovementSchema = new Schema(
  {
    inventoryItemId: objectIdField(),
    delta: signedIntegerField(),
    reason: {
      type: String,
      required: true,
      enum: ["initial", "purchase", "sale", "waste", "adjustment", "refund", "reversal"],
    },
    before: nonNegativeIntegerField(),
    after: nonNegativeIntegerField(),
    unit: { type: String, required: true, enum: ["gram", "milliliter", "piece"] },
    reversalOf: { ...objectIdField(false), default: null },
    requestId: { ...objectIdField(false), default: null },
    fingerprint: requiredText(64),
    orderId: { ...objectIdField(false), default: null },
    actorKind: { type: String, required: true, enum: ["admin", "system"] },
    actorId: { ...objectIdField(false), default: null },
    idempotencyKey: requiredText(128),
  },
  { ...documentSchemaOptions(), collection: "inventory_movements" },
);
inventoryMovementSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "movement_idempotency_unique" },
);
inventoryMovementSchema.index(
  { inventoryItemId: 1, createdAt: -1 },
  { name: "movement_item_created" },
);
inventoryMovementSchema.index({ orderId: 1, createdAt: -1 }, { name: "movement_order_created" });
inventoryMovementSchema.index(
  { reversalOf: 1 },
  {
    unique: true,
    name: "movement_reversal_unique",
    partialFilterExpression: { reversalOf: { $type: "objectId" } },
  },
);
inventoryMovementSchema.index(
  { requestId: 1 },
  {
    unique: true,
    name: "movement_approval_unique",
    partialFilterExpression: { requestId: { $type: "objectId" } },
  },
);
inventoryMovementSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Inventory movements are append-only");
});
inventoryMovementSchema.pre(/^(?:update|delete|replace|findOneAnd)/, function () {
  throw new Error("Inventory movements are append-only");
});
inventoryMovementSchema.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error("Inventory movements are append-only");
});
inventoryMovementSchema.pre("validate", function () {
  const reason = this.get("reason"),
    delta = this.get("delta");
  if (
    (["initial", "purchase"].includes(reason) && delta <= 0) ||
    (["sale", "waste"].includes(reason) && delta >= 0)
  )
    this.invalidate("delta", "Movement sign must match reason");
  if ((reason === "reversal") !== Boolean(this.get("reversalOf")))
    this.invalidate("reversalOf", "Only reversal movements reference an original");
  if (this.get("delta") === 0 || this.get("after") !== this.get("before") + this.get("delta"))
    this.invalidate("delta", "Movement balance must reconcile");
  if (this.get("actorKind") === "admin" && !this.get("actorId")) {
    this.invalidate("actorId", "Admin movement needs an actor");
  }
});

export const stockApprovalRequestSchema = new Schema(
  {
    inventoryItemId: objectIdField(),
    requestedDelta: signedIntegerField(),
    kind: {
      type: String,
      required: true,
      enum: ["initial", "purchase", "adjustment", "waste", "reversal"],
    },
    unit: { type: String, required: true, enum: ["gram", "milliliter", "piece"] },
    idempotencyKey: requiredText(100),
    fingerprint: requiredText(64),
    reversalOf: { ...objectIdField(false), default: null },
    movementId: { ...objectIdField(false), default: null },
    reason: requiredText(1000),
    requestedBy: objectIdField(),
    decidedBy: { ...objectIdField(false), default: null },
    decidedAt: { type: Date, default: null },
    status: {
      type: String,
      required: true,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { ...documentSchemaOptions(true), collection: "stock_approval_requests" },
);
stockApprovalRequestSchema.index(
  { status: 1, createdAt: -1 },
  { name: "stock_approval_status_created" },
);
stockApprovalRequestSchema.index(
  { inventoryItemId: 1, createdAt: -1 },
  { name: "stock_approval_item_created" },
);
stockApprovalRequestSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "stock_request_idempotency_unique" },
);
stockApprovalRequestSchema.pre("validate", function () {
  if (this.get("requestedDelta") === 0)
    this.invalidate("requestedDelta", "Stock change cannot be zero");
  if ((this.get("kind") === "reversal") !== Boolean(this.get("reversalOf")))
    this.invalidate("reversalOf", "Reversal target required only for reversals");
  if ((this.get("status") === "approved") !== Boolean(this.get("movementId")))
    this.invalidate("movementId", "Only approved requests must reference a movement");
  const decided = Boolean(this.get("decidedBy") && this.get("decidedAt"));
  if (this.get("status") === "pending" && (this.get("decidedBy") || this.get("decidedAt"))) {
    this.invalidate("status", "Pending approval cannot have a decision");
  }
  if (this.get("status") !== "pending" && !decided) {
    this.invalidate("decidedBy", "Decided approval needs actor and timestamp");
  }
});
