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
const orderItemSnapshotSchema = new Schema(
  {
    productId: objectIdField(),
    productName: requiredText(160),
    categoryName: requiredText(120),
    additions: { type: [additionSnapshotSchema], default: [] },
    quantity: positiveIntegerField(),
    unitPriceToman: tomanAmountField(),
    lineTotalToman: tomanAmountField(),
  },
  { _id: false, strict: "throw" },
);

export const orderSchema = new Schema(
  {
    code: { type: String, required: true, match: /^AC-[0-9]{7,}$/ },
    snapshotVersion: { type: Number, required: true, enum: [1], default: 1, immutable: true },
    customerId: { ...objectIdField(false), default: null },
    items: { type: [orderItemSnapshotSchema], required: true, immutable: true },
    totalToman: { ...tomanAmountField(), immutable: true },
    status: {
      type: String,
      required: true,
      enum: ["placed", "preparing", "ready", "completed", "cancelled"],
      default: "placed",
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ["unpaid", "pending", "paid", "refunded"],
      default: "unpaid",
    },
    idempotencyKey: requiredText(128),
    placedAt: { ...utcDateField(), immutable: true },
    notes: { type: String, maxlength: 1000, default: "" },
  },
  { ...documentSchemaOptions(true), collection: "orders" },
);

orderSchema.pre("validate", function () {
  const items = this.get("items") as {
    quantity: number;
    unitPriceToman: number;
    lineTotalToman: number;
  }[];
  if (!items.length) this.invalidate("items", "Order needs at least one item");
  for (const item of items)
    if (item.lineTotalToman !== item.quantity * item.unitPriceToman)
      this.invalidate("items", "Order line total mismatch");
  if (this.get("totalToman") !== items.reduce((sum, item) => sum + item.lineTotalToman, 0))
    this.invalidate("totalToman", "Order total mismatch");
});
orderSchema.index({ code: 1 }, { unique: true, name: "order_code_unique" });
orderSchema.index(
  { "items.productId": 1, paymentStatus: 1, status: 1 },
  { name: "order_product_sales" },
);
orderSchema.index({ idempotencyKey: 1 }, { unique: true, name: "order_idempotency_unique" });
orderSchema.index({ status: 1, placedAt: -1 }, { name: "order_status_placed" });
orderSchema.index({ paymentStatus: 1, placedAt: -1 }, { name: "order_payment_placed" });
orderSchema.index({ customerId: 1, placedAt: -1 }, { name: "order_customer_placed" });
