import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import { renderInvoiceHtml } from "../../src/modules/invoices/domain/printing.ts";
import { makeIssuedInvoice } from "../../src/modules/invoices/domain/snapshot.ts";

const require = createRequire(import.meta.url);

test("invoice endpoints require real sessions and reject cross-origin reprints", async ({
  request,
}) => {
  const id = "000000000000000000000001";
  for (const path of [
    `/api/admin/orders/${id}/invoice`,
    `/api/admin/orders/${id}/invoice/print`,
    `/api/customer/orders/${id}/invoice`,
    `/api/customer/orders/${id}/invoice/print`,
  ]) {
    const response = await request.get(path, {
      headers: { "X-Admin-Role": "OWNER", "X-Customer-ID": id },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  expect(
    (
      await request.post(`/api/admin/orders/${id}/invoice/reprint`, {
        headers: { Origin: "https://evil.example" },
        data: { idempotencyKey: "receipt-key-001" },
      })
    ).status(),
  ).toBe(403);
});

test("local Persian font shapes mixed-script thermal receipt at both widths", async ({ page }) => {
  const font = await readFile(
    require.resolve("@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2"),
  );
  const snapshot = makeIssuedInvoice(
    {
      id: "0123456789abcdef01234567",
      code: "AC-0008932",
      customer: {
        id: "abcdef0123456789abcdef01",
        displayName: "علی محمدی",
        phone: "+989123456789",
      },
      items: [
        {
          productName: "قهوه لاته ویژه با نام بلند و اعداد 123",
          categoryName: "قهوه",
          additions: [{ name: "شیر بادام", priceToman: 10000 }],
          quantity: 2,
          unitPriceToman: 110000,
          lineTotalToman: 220000,
        },
      ],
      pricing: { subtotalToman: 220000, discountToman: 0, deliveryToman: 0, totalToman: 220000 },
      transaction: { provider: "fake", reference: "REF-123/ABC" },
      notes: "لطفاً داغ باشد",
      placedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      identity: {
        title: "کافه آرمانی",
        legalName: "",
        address: "تهران",
        phone: "02112345678",
        email: "",
        footer: "سپاس از شما",
      },
      paperWidthMm: 58,
    },
  );
  for (const width of [58, 80] as const) {
    await page.setViewportSize({ width: width === 58 ? 260 : 350, height: 800 });
    await page.setContent(
      renderInvoiceHtml(
        { ...snapshot, id: "111111111111111111111111" },
        width,
        `data:font/woff2;base64,${font.toString("base64")}`,
      ),
    );
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check("11px ReceiptVazirmatn", "کافه آرمانی")),
    ).toBe(true);
    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    await expect(page.getByText("قهوه لاته ویژه با نام بلند و اعداد 123")).toBeVisible();
    await expect(page.locator("bdi[dir='ltr']").filter({ hasText: "REF-123/ABC" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
