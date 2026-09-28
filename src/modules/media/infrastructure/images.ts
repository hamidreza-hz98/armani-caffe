import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

import type { UploadInput } from "../application/storage.ts";
import { MAX_MEDIA_PIXELS, validateMediaInput } from "../domain/storage-policy.ts";

export async function normalizeImage(input: UploadInput) {
  validateMediaInput(input.bytes.byteLength, input.mimeType);
  const bytes = Buffer.from(input.bytes);
  // Reject active/unsupported formats before invoking the native decoder.
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp =
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isJpeg && !isPng && !isWebp) throw new RangeError("Unsupported image signature");
  const metadata = await sharp(bytes, {
    limitInputPixels: MAX_MEDIA_PIXELS,
    failOn: "warning",
  }).metadata();
  const mime = (
    { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>
  )[metadata.format ?? ""];
  if (!mime || mime !== input.mimeType || (metadata.pages ?? 1) !== 1)
    throw new RangeError("Image contents do not match an allowed single-frame type");
  const results = [];
  for (const [variant, width] of [
    ["original", 4096],
    ["small", 320],
    ["large", 1280],
  ] as const) {
    const output = await sharp(bytes, { limitInputPixels: MAX_MEDIA_PIXELS, failOn: "warning" })
      .autoOrient()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .timeout({ seconds: 10 })
      .toBuffer();
    validateMediaInput(output.byteLength, "image/webp");
    results.push({
      variant,
      bytes: output,
      sha256: createHash("sha256").update(output).digest("hex"),
    });
  }
  return results;
}
