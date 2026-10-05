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
  { name: requiredText(120), priceToman: tomanAmountField() },
  { _id: false, strict: "throw" },
);
const invoiceLineSchema = new Schema(
  {
    productName: requiredText(160),
    categoryName: requiredText(120),
    additions: { type: [additionSnapshotSchema], default: [] },
    quantity: positiveIntegerField(),
    note: { type: String, maxlength: 300, default: "", immutable: true },
    unitPriceToman: tomanAmountField(),
    lineTotalToman: tomanAmountField(),
  },
  { _id: false, strict: "throw" },
);

export const invoiceSchema = new Schema(
  {
    orderId: { ...objectIdField(), immutable: true },
    customerId: { ...objectIdField(false), immutable: true },
    snapshotVersion: { type: Number, required: true, enum: [1, 2], default: 1, immutable: true },
    number: { ...requiredText(60), immutable: true },
    orderCode: { type: String, maxlength: 60, immutable: true },
    identity: { type: Schema.Types.Mixed, immutable: true },
    customer: { type: Schema.Types.Mixed, immutable: true },
    lines: { type: [invoiceLineSchema], required: true, immutable: true },
    totalToman: { ...tomanAmountField(), immutable: true },
    pricing: { type: Schema.Types.Mixed, immutable: true },
    transaction: { type: Schema.Types.Mixed, immutable: true },
    notes: { type: String, maxlength: 1000, immutable: true },
    tableNumber: {
      type: Number,
      min: 1,
      max: 999,
      default: null,
      validate: (value: number | null) => value === null || Number.isSafeInteger(value),
      immutable: true,
    },
    issuedAt: { ...utcDateField(), immutable: true },
    jalaliDateTime: { type: String, maxlength: 24, immutable: true },
    paperWidthMm: { type: Number, enum: [58, 80], immutable: true },
    printing: { type: Schema.Types.Mixed, immutable: true },
    status: { type: String, required: true, enum: ["issued", "voided"], default: "issued" },
    voidedAt: { type: Date, default: null },
  },
  { ...documentSchemaOptions(), collection: "invoices" },
);

invoiceSchema.pre("validate", function () {
  const lines = this.get("lines") as {
    quantity: number;
    unitPriceToman: number;
    lineTotalToman: number;
  }[];
  if (!lines.length) this.invalidate("lines", "Invoice needs at least one line");
  for (const line of lines)
    if (line.lineTotalToman !== line.quantity * line.unitPriceToman)
      this.invalidate("lines", "Invoice line total mismatch");
  const pricing = this.get("pricing") as
    | {
        subtotalToman?: number;
        discountToman?: number;
        deliveryToman?: number;
        totalToman?: number;
      }
    | undefined;
  const expected = lines.reduce((sum, line) => sum + line.lineTotalToman, 0);
  if (
    this.get("snapshotVersion") === 2 &&
    (pricing?.subtotalToman !== expected ||
      pricing.totalToman !== expected - (pricing.discountToman ?? 0) + (pricing.deliveryToman ?? 0))
  )
    this.invalidate("pricing", "Invoice pricing mismatch");
  if (
    this.get("totalToman") !== (this.get("snapshotVersion") === 2 ? pricing?.totalToman : expected)
  )
    this.invalidate("totalToman", "Invoice total mismatch");
});
invoiceSchema.index({ orderId: 1 }, { unique: true, name: "invoice_order_unique" });
invoiceSchema.index({ number: 1 }, { unique: true, name: "invoice_number_unique" });
invoiceSchema.index({ issuedAt: -1 }, { name: "invoice_issued" });
invoiceSchema.index({ status: 1, issuedAt: -1 }, { name: "invoice_status_issued" });
invoiceSchema.pre("validate", function () {
  if (this.get("snapshotVersion") === 2)
    for (const field of [
      "customerId",
      "orderCode",
      "identity",
      "customer",
      "pricing",
      "transaction",
      "jalaliDateTime",
      "paperWidthMm",
    ])
      if (this.get(field) === undefined || this.get(field) === null)
        this.invalidate(field, "Invoice v2 snapshot is incomplete");
  if (this.get("status") === "voided" && !this.get("voidedAt")) {
    this.invalidate("voidedAt", "Voided invoice needs a timestamp");
  }
});
export const invoiceReprintSchema = new Schema(
  {
    invoiceId: objectIdField(),
    orderId: objectIdField(),
    actorId: objectIdField(),
    idempotencyKey: requiredText(100),
    paperWidthMm: { type: Number, required: true, enum: [58, 80] },
    requestedAt: utcDateField(),
  },
  { ...documentSchemaOptions(), collection: "invoice_reprints" },
);
invoiceReprintSchema.index(
  { actorId: 1, idempotencyKey: 1 },
  { unique: true, name: "invoice_reprint_actor_key_unique" },
);
invoiceReprintSchema.index(
  { invoiceId: 1, requestedAt: -1 },
  { name: "invoice_reprint_invoice_requested" },
);
