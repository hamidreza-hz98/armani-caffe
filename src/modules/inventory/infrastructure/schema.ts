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
      enum: ["purchase", "sale", "waste", "adjustment", "refund"],
    },
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
inventoryMovementSchema.pre("validate", function () {
  if (this.get("actorKind") === "admin" && !this.get("actorId")) {
    this.invalidate("actorId", "Admin movement needs an actor");
  }
});

export const stockApprovalRequestSchema = new Schema(
  {
    inventoryItemId: objectIdField(),
    requestedDelta: signedIntegerField(),
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
stockApprovalRequestSchema.pre("validate", function () {
  const decided = Boolean(this.get("decidedBy") && this.get("decidedAt"));
  if (this.get("status") === "pending" && (this.get("decidedBy") || this.get("decidedAt"))) {
    this.invalidate("status", "Pending approval cannot have a decision");
  }
  if (this.get("status") !== "pending" && !decided) {
    this.invalidate("decidedBy", "Decided approval needs actor and timestamp");
  }
});
