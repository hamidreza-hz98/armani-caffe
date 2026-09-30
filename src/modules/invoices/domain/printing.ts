import { ApplicationError } from "../../../shared/errors.ts";
import type { IssuedInvoice } from "./snapshot.ts";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
const digits = (value: string) => value.replace(/\d/gu, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
const money = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;
const ltr = (value: string) => `<bdi dir="ltr">${escape(value)}</bdi>`;

/** Self-contained printable document: all business data is from the persisted snapshot. */
export function renderInvoiceHtml(
  invoice: IssuedInvoice,
  paperWidthMm: 58 | 80 = invoice.paperWidthMm,
  fontDataUrl?: string,
): string {
  if (paperWidthMm !== 58 && paperWidthMm !== 80)
    throw new ApplicationError("VALIDATION", "Invalid receipt width");
  if (fontDataUrl && !/^data:font\/woff2;base64,[a-zA-Z0-9+/=]+$/u.test(fontDataUrl))
    throw new ApplicationError("VALIDATION", "Invalid local font");
  const font = fontDataUrl
    ? `@font-face{font-family:ReceiptVazirmatn;src:url('${fontDataUrl}') format('woff2');font-display:block}`
    : "";
  const rows = invoice.lines
    .map(
      (line) =>
        `<section class="line"><div class="line-head"><span>${escape(line.productName)} <small>× ${digits(String(line.quantity))}</small></span><strong>${money(line.lineTotalToman)}</strong></div><small>${escape(line.categoryName)}</small>${line.additions.map((addition) => `<div class="addition">+ ${escape(addition.name)} · ${money(addition.priceToman)}</div>`).join("")}</section>`,
    )
    .join("");
  const sum = (label: string, value: number, className = "") =>
    `<div class="sum ${className}"><span>${label}</span><strong>${money(value)}</strong></div>`;
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(invoice.number)}</title><style>${font}@page{size:${paperWidthMm}mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#1d1713}body{font-family:ReceiptVazirmatn,Vazirmatn,sans-serif;font-size:11px;line-height:1.7}.receipt{width:${paperWidthMm}mm;max-width:100%;padding:4mm;margin:auto}.brand{text-align:center;border-bottom:1px dashed #5a504b;padding-bottom:2mm}.brand h1{font-size:17px;margin:0}.brand p{margin:0}.meta{padding:2mm 0;border-bottom:1px dashed #5a504b}.meta div,.sum,.line-head{display:flex;justify-content:space-between;gap:2mm;align-items:baseline}.meta span:first-child,.sum span{white-space:nowrap}.line{padding:2mm 0;border-bottom:1px dotted #bbb;overflow-wrap:anywhere}.line-head span{min-width:0;overflow-wrap:anywhere}.line-head strong,.sum strong{white-space:nowrap}.addition{padding-right:2mm;color:#51483e;overflow-wrap:anywhere}small{font-size:9px;color:#5a504b}.totals{padding:2mm 0}.sum.total{border-top:1px solid #1d1713;margin-top:1mm;padding-top:2mm;font-size:13px}.footer{text-align:center;border-top:1px dashed #5a504b;padding-top:2mm;overflow-wrap:anywhere}bdi{direction:ltr;unicode-bidi:isolate}.notes{overflow-wrap:anywhere}@media screen{body{background:#eee}.receipt{background:#fff;min-height:120mm;box-shadow:0 2px 12px #0002}}@media print{.receipt{margin:0;box-shadow:none}body{print-color-adjust:exact}}</style></head><body><main class="receipt"><header class="brand"><h1>${escape(invoice.identity.title)}</h1>${invoice.identity.legalName ? `<p>${escape(invoice.identity.legalName)}</p>` : ""}${invoice.identity.address ? `<p>${escape(invoice.identity.address)}</p>` : ""}</header><div class="meta"><div><span>سفارش</span>${ltr(invoice.orderCode)}</div><div><span>تاریخ</span><bdi dir="ltr">${digits(escape(invoice.jalaliDateTime))}</bdi></div><div><span>مشتری</span><span>${escape(invoice.customer.displayName ?? "مشتری")}</span></div><div><span>تلفن</span>${ltr(invoice.customer.phone)}</div></div><section class="items">${rows}</section><section class="totals">${sum("جمع جزء", invoice.pricing.subtotalToman)}${sum("تخفیف", invoice.pricing.discountToman)}${sum("ارسال", invoice.pricing.deliveryToman)}${sum("مبلغ پرداختی", invoice.totalToman, "total")}</section><div class="meta"><div><span>پرداخت</span>${ltr(invoice.transaction.provider)}</div><div><span>پیگیری</span>${ltr(invoice.transaction.reference)}</div><div><span>شماره فاکتور</span>${ltr(invoice.number)}</div></div>${invoice.notes ? `<p class="notes">${escape(invoice.notes)}</p>` : ""}<footer class="footer">${invoice.identity.phone ? `<p>تماس: ${ltr(invoice.identity.phone)}</p>` : ""}${invoice.identity.email ? `<p>${ltr(invoice.identity.email)}</p>` : ""}${invoice.identity.footer ? `<p>${escape(invoice.identity.footer)}</p>` : ""}</footer></main></body></html>`;
}

/** GS v 0 raster. The printer receives pixels, never unshaped Persian codepoints. */
export function escPosRaster(
  grayscale: Uint8Array,
  widthPx: 384 | 576,
  heightPx: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(heightPx) ||
    heightPx < 1 ||
    heightPx > 8192 ||
    grayscale.length !== widthPx * heightPx
  )
    throw new ApplicationError("VALIDATION", "Invalid receipt raster");
  const stride = widthPx / 8;
  const output = new Uint8Array(2 + 8 + stride * heightPx + 4);
  output.set([
    0x1b,
    0x40,
    0x1d,
    0x76,
    0x30,
    0x00,
    stride & 255,
    stride >> 8,
    heightPx & 255,
    heightPx >> 8,
  ]);
  for (let y = 0; y < heightPx; y++)
    for (let x = 0; x < widthPx; x++)
      if (grayscale[y * widthPx + x]! < 128) output[10 + y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
  output.set([0x0a, 0x1d, 0x56, 0x00], output.length - 4);
  return output;
}
