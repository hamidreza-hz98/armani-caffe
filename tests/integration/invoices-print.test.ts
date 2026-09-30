import sharp from "sharp";
import { expect, test } from "vitest";

import { receiptPngToEscPos } from "@/modules/invoices/server";

test.each([
  { paperWidthMm: 58 as const, pixels: 384 },
  { paperWidthMm: 80 as const, pixels: 576 },
])(
  "converts a $paperWidthMm mm browser raster to ESC/POS without sending text bytes",
  async ({ paperWidthMm, pixels }) => {
    const png = await sharp({
      create: { width: pixels, height: 2, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const bytes = await receiptPngToEscPos(png, paperWidthMm);
    expect([...bytes.slice(0, 10)]).toEqual([27, 64, 29, 118, 48, 0, pixels / 8, 0, 2, 0]);
    expect(bytes.byteLength).toBe(14 + pixels / 4);
    expect([...bytes.slice(-4)]).toEqual([10, 29, 86, 0]);
  },
);

test("rejects a raster with the wrong printer dot width", async () => {
  const png = await sharp({ create: { width: 576, height: 1, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
  await expect(receiptPngToEscPos(png, 58)).rejects.toMatchObject({ code: "VALIDATION" });
});
