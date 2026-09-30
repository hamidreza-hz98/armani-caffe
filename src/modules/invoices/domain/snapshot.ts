import {
  asToman,
  asUtcTimestamp,
  type TomanAmount,
  type UtcTimestamp,
} from "../../../shared/domain.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { type InvoiceLineSnapshot, makeInvoiceLines } from "./model.ts";

export type InvoiceIdentity = Readonly<{
  title: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  footer: string;
}>;
export type IssuedInvoice = Readonly<{
  id: string;
  orderId: string;
  customerId: string;
  snapshotVersion: 2;
  number: string;
  orderCode: string;
  identity: InvoiceIdentity;
  customer: Readonly<{ displayName: string | null; phone: string }>;
  lines: readonly InvoiceLineSnapshot[];
  pricing: Readonly<{
    subtotalToman: TomanAmount;
    discountToman: TomanAmount;
    deliveryToman: TomanAmount;
    totalToman: TomanAmount;
  }>;
  totalToman: TomanAmount;
  transaction: Readonly<{ provider: string; reference: string }>;
  notes: string;
  issuedAt: UtcTimestamp;
  jalaliDateTime: string;
  paperWidthMm: 58 | 80;
  status: "issued";
}>;
export type ConfirmedOrderSource = Readonly<{
  id: string;
  code: string;
  customer: Readonly<{ id: string; displayName: string | null; phone: string }>;
  items: readonly {
    productName: string;
    categoryName: string;
    additions: readonly { name: string; priceToman: number }[];
    quantity: number;
    unitPriceToman: number;
    lineTotalToman: number;
  }[];
  pricing: {
    subtotalToman: number;
    discountToman: number;
    deliveryToman: number;
    totalToman: number;
  };
  transaction: { provider: string; reference: string };
  notes: string;
  placedAt: string;
}>;
const tehranJalali = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** Persist the display result so later timezone or ICU changes cannot alter old invoices. */
export function jalaliReceiptDate(utc: string): string {
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== utc)
    throw new ApplicationError("VALIDATION", "UTC invoice timestamp required");
  const parts = tehranJalali.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}
export function makeIssuedInvoice(
  source: ConfirmedOrderSource,
  settings: { identity: InvoiceIdentity; paperWidthMm: 58 | 80 },
): Omit<IssuedInvoice, "id"> {
  if (
    !/^[a-f\d]{24}$/u.test(source.id) ||
    !/^AC-\d{7,}$/u.test(source.code) ||
    !/^[a-f\d]{24}$/u.test(source.customer.id) ||
    !source.transaction.provider ||
    !source.transaction.reference
  )
    throw new ApplicationError("VALIDATION", "Invalid confirmed order source");
  const lines = makeInvoiceLines(source.items);
  const pricing = Object.freeze({
    subtotalToman: asToman(source.pricing.subtotalToman),
    discountToman: asToman(source.pricing.discountToman),
    deliveryToman: asToman(source.pricing.deliveryToman),
    totalToman: asToman(source.pricing.totalToman),
  });
  if (
    lines.some((line) => line.lineTotalToman !== line.unitPriceToman * line.quantity) ||
    pricing.totalToman !== pricing.subtotalToman - pricing.discountToman + pricing.deliveryToman ||
    pricing.subtotalToman !== lines.reduce((sum, line) => sum + line.lineTotalToman, 0) ||
    pricing.totalToman < 1
  )
    throw new ApplicationError("VALIDATION", "Invoice totals differ from confirmed order");
  if (![58, 80].includes(settings.paperWidthMm) || !settings.identity.title.trim())
    throw new ApplicationError("VALIDATION", "Invalid invoice identity");
  const issuedAt = asUtcTimestamp(source.placedAt);
  return Object.freeze({
    orderId: source.id,
    customerId: source.customer.id,
    snapshotVersion: 2 as const,
    number: `INV-${source.code}`,
    orderCode: source.code,
    identity: Object.freeze({ ...settings.identity }),
    customer: Object.freeze({
      displayName: source.customer.displayName,
      phone: source.customer.phone,
    }),
    lines,
    pricing,
    totalToman: pricing.totalToman,
    transaction: Object.freeze({
      provider: source.transaction.provider,
      reference: source.transaction.reference,
    }),
    notes: source.notes,
    issuedAt,
    jalaliDateTime: jalaliReceiptDate(issuedAt),
    paperWidthMm: settings.paperWidthMm,
    status: "issued" as const,
  });
}
