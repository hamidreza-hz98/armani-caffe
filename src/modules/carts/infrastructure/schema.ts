import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions, tomanAmountField } from "../../../server/database/conventions.ts";
import {
  objectIdField,
  positiveIntegerField,
  requiredText,
  utcDateField,
} from "../../../server/database/schema-fields.ts";

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
    quantity: positiveIntegerField(),
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
    status: {
      type: String,
      required: true,
      enum: ["active", "checked_out", "abandoned"],
      default: "active",
    },
    expiresAt: utcDateField(),
  },
  { ...documentSchemaOptions(true), collection: "carts" },
);

cartSchema.pre("validate", function () {
  const items = this.get("items") as {
    quantity: number;
    unitPriceToman: number;
    lineTotalToman: number;
  }[];
  for (const item of items)
    if (item.lineTotalToman !== item.quantity * item.unitPriceToman)
      this.invalidate("items", "Cart line total mismatch");
  if (this.get("totalToman") !== items.reduce((sum, item) => sum + item.lineTotalToman, 0))
    this.invalidate("totalToman", "Cart total mismatch");
  if (!this.get("customerId") && !this.get("sessionId"))
    this.invalidate("customerId", "Cart needs an owner");
});
cartSchema.index({ customerId: 1, status: 1, updatedAt: -1 }, { name: "cart_customer_status" });
cartSchema.index({ sessionId: 1, status: 1, updatedAt: -1 }, { name: "cart_session_status" });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "cart_expiry_ttl" });
