import type { Browser } from "playwright";
import { chromium } from "playwright";
import sharp from "sharp";

import { escPosRaster } from "../src/modules/invoices/domain/printing.ts";
import type { PrintDelivery } from "./protocol.ts";

/** Chromium shapes Persian and isolates mixed-direction text before raster ESC/POS conversion. */
export class ReceiptRenderer {
  private browser?: Browser;
  private readonly channel?: string;
  constructor(channel?: string) {
    this.channel = channel;
  }
  async render(job: PrintDelivery): Promise<Uint8Array> {
    this.browser ??= await chromium.launch({
      headless: true,
      ...(this.channel ? { channel: this.channel } : {}),
    });
    const width = job.paperWidthMm === 58 ? 384 : 576;
    const cssWidth = (job.paperWidthMm * 96) / 25.4;
    const context = await this.browser.newContext({
      viewport: { width: Math.ceil(cssWidth), height: 1000 },
      deviceScaleFactor: width / cssWidth,
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    try {
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      await page.emulateMedia({ media: "print" });
      await page.setContent(job.html, { waitUntil: "load", timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      const receipt = page.locator("main.receipt");
      const bounds = await receipt.boundingBox();
      if (!bounds || bounds.height * (width / cssWidth) > 8192) throw new Error("RECEIPT_TOO_LONG");
      const png = await receipt.screenshot({
        type: "png",
        animations: "disabled",
        timeout: 15_000,
      });
      const { data, info } = await sharp(png, { limitInputPixels: width * 8192 })
        .resize({ width })
        .flatten({ background: "#ffffff" })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.width !== width || info.height > 8192 || info.channels !== 1)
        throw new Error("INVALID_RASTER");
      return escPosRaster(data, width, info.height);
    } finally {
      await context.close();
    }
  }
  async close() {
    await this.browser?.close();
    this.browser = undefined;
  }
}
