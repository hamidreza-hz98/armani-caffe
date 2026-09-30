import { describe, expect, it } from "vitest";

import {
  escPosRaster,
  jalaliReceiptDate,
  makeIssuedInvoice,
  renderInvoiceHtml,
} from "@/modules/invoices";

const invoice = makeIssuedInvoice(
  {
    id: "0123456789abcdef01234567",
    code: "AC-0008932",
    customer: { id: "abcdef0123456789abcdef01", displayName: "علی محمدی", phone: "+989123456789" },
    items: [
      {
        productName: "لاته ویژه با نام خیلی بلند و عدد 123 <شیر>",
        categoryName: "قهوه",
        quantity: 2,
        unitPriceToman: 110000,
        lineTotalToman: 220000,
        additions: [{ name: "شیر بادام", priceToman: 10000 }],
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
const issued = { ...invoice, id: "111111111111111111111111" };

describe("immutable invoice and Persian printing", () => {
  it("derives a fixed Jalali Tehran display time from UTC", () => {
    expect(jalaliReceiptDate("2026-01-01T00:00:00.000Z")).toBe("1404/10/11 03:30");
    expect(issued.jalaliDateTime).toBe("1404/10/11 03:30");
    expect(issued.issuedAt).toBe("2026-01-01T00:00:00.000Z");
  });
  it.each([58, 80] as const)("renders %imm receipt with escaped mixed-script content", (width) => {
    const html = renderInvoiceHtml(issued, width);
    expect(html).toContain(`<html lang="fa" dir="rtl">`);
    expect(html).toContain(`@page{size:${width}mm auto`);
    expect(html).toContain("لاته ویژه با نام خیلی بلند و عدد 123 &lt;شیر&gt;");
    expect(html).toContain("+ شیر بادام · ۱۰٬۰۰۰ تومان");
    expect(html).toContain('<bdi dir="ltr">REF-123/ABC</bdi>');
    expect(html).toContain("۱۴۰۴/۱۰/۱۱ ۰۳:۳۰");
    expect(html).toContain("سپاس از شما");
    expect(html).not.toContain("<شیر>");
  });
  it("emits compact GS v 0 monochrome data at both printer widths", () => {
    for (const width of [384, 576] as const) {
      const gray = new Uint8Array(width).fill(255);
      gray[0] = 0;
      gray[7] = 0;
      gray[8] = 0;
      const bytes = escPosRaster(gray, width, 1);
      expect([...bytes.slice(0, 11)]).toEqual([27, 64, 29, 118, 48, 0, width / 8, 0, 1, 0, 129]);
      expect(bytes[11]).toBe(128);
      expect([...bytes.slice(-4)]).toEqual([10, 29, 86, 0]);
    }
  });
  it("rejects invalid totals and oversized printer raster", () => {
    expect(() =>
      makeIssuedInvoice(
        {
          id: "0123456789abcdef01234567",
          code: "AC-0008932",
          customer: { id: "abcdef0123456789abcdef01", displayName: null, phone: "+989123456789" },
          items: [],
          pricing: { subtotalToman: 1, discountToman: 0, deliveryToman: 0, totalToman: 1 },
          transaction: { provider: "fake", reference: "ref" },
          notes: "",
          placedAt: "2026-01-01T00:00:00.000Z",
        },
        { identity: issued.identity, paperWidthMm: 80 },
      ),
    ).toThrow();
    expect(() => escPosRaster(new Uint8Array(384), 384, 8193)).toThrow();
  });
});
