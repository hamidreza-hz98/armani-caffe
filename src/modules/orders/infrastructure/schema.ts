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
    customerId: { ...objectIdField(false), default: null, immutable: true },
    items: { type: [orderItemSnapshotSchema], required: true, immutable: true },
    totalToman: { ...tomanAmountField(), immutable: true },
    status: {
      type: String,
      required: true,
      enum: ["NEW", "PREPARING", "READY", "COMPLETED", "CANCELLED"],
      default: "NEW",
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ["unpaid", "pending", "paid", "refunded"],
      default: "unpaid",
    },
    idempotencyKey: requiredText(128),
    placedAt: { ...utcDateField(), immutable: true },
    notes: { type: String, maxlength: 1000, default: "", immutable: true },
    checkoutId: { ...objectIdField(false), immutable: true },
    cartId: { ...objectIdField(false), immutable: true },
    transactionId: { ...objectIdField(false), immutable: true },
    customer: { type: Schema.Types.Mixed, immutable: true },
    pricing: { type: Schema.Types.Mixed, immutable: true },
    transaction: { type: Schema.Types.Mixed, immutable: true },
    refundStatus: { type: String, enum: ["NONE", "REQUESTED", "REFUNDED"], default: "NONE" },
    cancellationReason: { type: String, maxlength: 1000, default: null },
    refundReason: { type: String, maxlength: 1000, default: null },
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
orderSchema.index({ placedAt: -1, _id: -1 }, { name: "order_recent" });
orderSchema.index({ customerId: 1, placedAt: -1, _id: -1 }, { name: "order_customer_recent" });
for (const field of ["checkoutId", "cartId", "transactionId"])
  orderSchema.index(
    { [field]: 1 },
    {
      unique: true,
      name: `order_${field}_unique`,
      partialFilterExpression: { [field]: { $type: "objectId" } },
    },
  );
export const checkoutIntentSchema = new Schema(
  {
    cartId: { ...objectIdField(), immutable: true },
    customerId: { ...objectIdField(), immutable: true },
    key: { ...requiredText(100), immutable: true },
    cartRevision: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    customer: { type: Schema.Types.Mixed, required: true, immutable: true },
    items: { type: [orderItemSnapshotSchema], required: true, immutable: true },
    pricing: { type: Schema.Types.Mixed, required: true, immutable: true },
    stock: {
      type: [
        new Schema(
          {
            inventoryItemId: requiredText(24),
            quantity: positiveIntegerField(),
            unit: { type: String, required: true, enum: ["gram", "milliliter", "piece"] },
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
      immutable: true,
    },
    notes: { type: String, maxlength: 1000, default: "", immutable: true },
    state: {
      type: String,
      required: true,
      enum: ["PAYMENT_PENDING", "RECOVERY_REQUIRED", "CONFIRMED", "REFUND_REQUESTED", "REFUNDED"],
    },
    recovery: {
      type: String,
      enum: [null, "INSUFFICIENT_STOCK", "CART_UNAVAILABLE"],
      default: null,
    },
    transactionId: { type: String, default: null },
    refundReason: { type: String, default: null, maxlength: 1000 },
  },
  { ...documentSchemaOptions(true), collection: "checkout_intents" },
);
checkoutIntentSchema.index(
  { customerId: 1, key: 1 },
  { unique: true, name: "checkout_customer_key_unique" },
);
checkoutIntentSchema.index({ cartId: 1 }, { unique: true, name: "checkout_cart_unique" });
checkoutIntentSchema.index({ state: 1, updatedAt: 1 }, { name: "checkout_recovery" });
checkoutIntentSchema.index(
  { transactionId: 1 },
  {
    unique: true,
    name: "checkout_transaction_unique",
    partialFilterExpression: { transactionId: { $type: "string" } },
  },
);
