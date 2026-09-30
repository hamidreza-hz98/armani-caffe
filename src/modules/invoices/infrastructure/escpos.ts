import "server-only";

import sharp from "sharp";

import { ApplicationError } from "../../../shared/errors.ts";
import { escPosRaster } from "../domain/printing.ts";

/** Accept a browser/bridge-rendered PNG of the HTML receipt at printer dot width. */
export async function receiptPngToEscPos(
  png: Uint8Array,
  paperWidthMm: 58 | 80,
): Promise<Uint8Array> {
  if (png.byteLength > 8_000_000)
    throw new ApplicationError("VALIDATION", "Receipt image too large");
  const width = paperWidthMm === 58 ? 384 : 576;
  const image = sharp(png, { limitInputPixels: width * 8192 });
  const metadata = await image.metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== width ||
    !metadata.height ||
    metadata.height > 8192
  )
    throw new ApplicationError("VALIDATION", "Invalid receipt PNG dimensions");
  const { data, info } = await image
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== width || info.height !== metadata.height)
    throw new ApplicationError("VALIDATION", "Invalid receipt pixels");
  return escPosRaster(data, width, info.height);
}
