import type { SettingsValues } from "./model.ts";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

/** A browser-only diagnostic sheet: deliberately no order code, payment or receipt wording. */
export function renderBrowserTestPrint(
  business: SettingsValues["business"],
  printing: SettingsValues["printing"],
  requestedAt: Date,
): string {
  const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(requestedAt);
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>چاپ آزمایشی — بدون سفارش</title><style>body{font:16px sans-serif;width:${printing.paperWidthMm}mm;max-width:100%;margin:0 auto;padding:8mm;box-sizing:border-box;color:#111}h1{font-size:20px;border:3px solid #111;padding:8px}p{overflow-wrap:anywhere}small{display:block;border-top:1px dashed #111;padding-top:8px}@media print{body{padding:2mm}}</style></head><body><h1>چاپ آزمایشی — بدون سفارش یا پرداخت</h1><p>${escapeHtml(business.title)}</p><p>زمان آزمایش: <bdi>${escapeHtml(date)}</bdi></p><p>عرض تنظیم‌شده: <bdi>${printing.paperWidthMm} mm</bdi> · نسخه‌ها: <bdi>${printing.copies}</bdi></p><p>شناسهٔ پل: <bdi>${escapeHtml(printing.bridgeId || "تنظیم نشده")}</bdi></p><p>${escapeHtml(printing.footer)}</p><small>این برگه فقط برای بررسی چاپ مرورگر است. رسید سفارش واقعی نیست و به پل چاپ ارسال نمی‌شود. برای چاپ از فرمان Print مرورگر استفاده کنید.</small></body></html>`;
}
