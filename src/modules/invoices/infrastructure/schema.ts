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
    unitPriceToman: tomanAmountField(),
    lineTotalToman: tomanAmountField(),
  },
  { _id: false, strict: "throw" },
);

export const invoiceSchema = new Schema(
  {
    orderId: objectIdField(),
    snapshotVersion: { type: Number, required: true, enum: [1], default: 1, immutable: true },
    number: requiredText(60),
    lines: { type: [invoiceLineSchema], required: true, immutable: true },
    totalToman: { ...tomanAmountField(), immutable: true },
    issuedAt: { ...utcDateField(), immutable: true },
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
  if (this.get("totalToman") !== lines.reduce((sum, line) => sum + line.lineTotalToman, 0))
    this.invalidate("totalToman", "Invoice total mismatch");
});
invoiceSchema.index({ orderId: 1 }, { unique: true, name: "invoice_order_unique" });
invoiceSchema.index({ number: 1 }, { unique: true, name: "invoice_number_unique" });
invoiceSchema.index({ issuedAt: -1 }, { name: "invoice_issued" });
invoiceSchema.index({ status: 1, issuedAt: -1 }, { name: "invoice_status_issued" });
invoiceSchema.pre("validate", function () {
  if (this.get("status") === "voided" && !this.get("voidedAt")) {
    this.invalidate("voidedAt", "Voided invoice needs a timestamp");
  }
});
