import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, tomanAmountField } from "../../../server/database/conventions.ts";
import {
  objectIdField,
  positiveIntegerField,
  requiredText,
  utcDateField,
} from "../../../server/database/schema-fields.ts";
import { CART_MAX_LINES, CART_MAX_QUANTITY } from "../contracts/cart.ts";

const additionSnapshotSchema = new Schema(
  {
    additionId: objectIdField(),
    name: requiredText(120),
    priceToman: tomanAmountField(),
  },
  { _id: false, strict: "throw" },
);
const cartItemSnapshotSchema = new Schema(
  {
    productId: objectIdField(),
    productName: requiredText(160),
    additions: { type: [additionSnapshotSchema], default: [] },
    quantity: { ...positiveIntegerField(), max: CART_MAX_QUANTITY },
    note: { type: String, maxlength: 300, default: "" },
    unitPriceToman: tomanAmountField(),
    lineTotalToman: tomanAmountField(),
  },
  { _id: false, strict: "throw" },
);

export const cartSchema = new Schema(
  {
    customerId: { ...objectIdField(false), default: null },
    sessionId: { ...objectIdField(false), default: null },
    items: { type: [cartItemSnapshotSchema], default: [] },
    totalToman: tomanAmountField(),
    notes: { type: String, maxlength: 1000, default: "" },
    tableNumber: {
      type: Number,
      min: 1,
      max: 999,
      default: null,
      validate: (value: number | null) => value === null || Number.isSafeInteger(value),
    },
    status: {
      type: String,
      required: true,
      enum: ["active", "payment_pending", "checked_out", "abandoned"],
      default: "active",
    },
    expiresAt: {
      ...utcDateField(false),
      required: function () {
        return this.get("status") !== "payment_pending";
      },
    },
    checkoutId: { ...objectIdField(false), default: null },
  },
  { ...documentSchemaOptions(true), collection: "carts" },
);

cartSchema.pre("validate", function () {
  const items = this.get("items") as {
    quantity: number;
    unitPriceToman: number;
    lineTotalToman: number;
  }[];
  if (items.length > CART_MAX_LINES) this.invalidate("items", "Cart line limit exceeded");
  for (const item of items)
    if (item.lineTotalToman !== item.quantity * item.unitPriceToman)
      this.invalidate("items", "Cart line total mismatch");
  if (this.get("totalToman") !== items.reduce((sum, item) => sum + item.lineTotalToman, 0))
    this.invalidate("totalToman", "Cart total mismatch");
  if (!this.get("customerId") && !this.get("sessionId"))
    this.invalidate("customerId", "Cart needs an owner");
});
cartSchema.index({ customerId: 1, status: 1, updatedAt: -1 }, { name: "cart_customer_status" });
cartSchema.index(
  { customerId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active", customerId: { $type: "objectId" } },
    name: "cart_one_active_customer",
  },
);
cartSchema.index({ sessionId: 1, status: 1, updatedAt: -1 }, { name: "cart_session_status" });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "cart_expiry_ttl" });
