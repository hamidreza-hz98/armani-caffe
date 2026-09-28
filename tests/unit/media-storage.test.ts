import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

import {
  assertOwnedKey,
  MAX_MEDIA_BYTES,
  mediaKey,
  stagingKey,
  validateMediaInput,
} from "../../src/modules/media/domain/storage-policy.ts";
import { normalizeImage } from "../../src/modules/media/infrastructure/images.ts";
import { MinioMediaStorage } from "../../src/modules/media/server.ts";

const owner = "000000000000000000000001";
const other = "000000000000000000000002";
const id = randomUUID();

describe("private media validation", () => {
  test("presigned policies bind key, type, exact size and short expiry; tickets reject tampering and expiration", async () => {
    const client = new S3Client({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "test-only-access", secretAccessKey: "test-only-secret" },
    });
    let now = Date.now();
    const storage = new MinioMediaStorage(client, "test-private", "a".repeat(64), () => now);
    try {
      const ticket = await storage.prepareUpload(owner, 123, "image/png");
      expect(ticket.expiresIn).toBe(120);
      expect(ticket.fields.key).toMatch(/^staging\/v1\//);
      const policy = JSON.parse(Buffer.from(ticket.fields.Policy, "base64").toString());
      expect(policy.conditions).toContainEqual(["content-length-range", 123, 123]);
      expect(policy.conditions).toContainEqual(["eq", "$Content-Type", "image/png"]);
      await expect(storage.cancelUpload(other, ticket.token)).rejects.toThrow();
      await expect(storage.cancelUpload(owner, `x${ticket.token}`)).rejects.toThrow();
      now += 16 * 60_000;
      await expect(storage.cancelUpload(owner, ticket.token)).rejects.toThrow(/Expired/);
    } finally {
      client.destroy();
    }
  });
  test("keys are opaque, owner scoped, versioned and path safe", () => {
    const key = mediaKey(owner, id, "a".repeat(64), "small");
    expect(key).toBe(`media/v1/${owner}/${id}/${"a".repeat(64)}-small.webp`);
    expect(() => assertOwnedKey(key, owner)).not.toThrow();
    expect(() => assertOwnedKey(key, other)).toThrow();
    for (const key of [
      "../secret",
      "/media/v1",
      "media/%2e%2e/file",
      "media\\file",
      "media/v1/owner/name.jpg",
    ])
      expect(() => assertOwnedKey(key, owner)).toThrow();
    expect(stagingKey(owner, id)).not.toContain(".jpg");
    expect(() => mediaKey(owner, id, "a".repeat(64), "../secret")).toThrow();
  });
  test("type, byte and bulk limits reject invalid inputs before I/O", async () => {
    for (const size of [0, -1, 1.5, MAX_MEDIA_BYTES + 1])
      expect(() => validateMediaInput(size, "image/png")).toThrow();
    for (const mime of ["image/svg+xml", "text/html", "application/pdf", "image/gif"])
      expect(() => validateMediaInput(100, mime)).toThrow();
    const storage = new MinioMediaStorage(
      new S3Client({ region: "us-east-1" }),
      "test-private",
      "a".repeat(64),
    );
    await expect(storage.uploadBulk(owner, [])).rejects.toThrow();
    await expect(
      storage.uploadBulk(owner, Array(6).fill({ bytes: new Uint8Array(1), mimeType: "image/png" })),
    ).rejects.toThrow();
    await expect(storage.finalizeUpload(owner, "forged.ticket")).rejects.toThrow();
    await expect(storage.read(owner, "../secret")).rejects.toThrow();
  });
  test("decoded type is checked and variants strip EXIF", async () => {
    const oversized = await sharp({
      create: { width: 4500, height: 4000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(normalizeImage({ bytes: oversized, mimeType: "image/png" })).rejects.toThrow();
    const bytes = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#d9b88b" },
    })
      .withMetadata({ exif: { IFD0: { Artist: "private person" } } })
      .jpeg()
      .toBuffer();
    await expect(normalizeImage({ bytes, mimeType: "image/png" })).rejects.toThrow();
    await expect(
      normalizeImage({ bytes: Buffer.from("<svg></svg>"), mimeType: "image/png" }),
    ).rejects.toThrow();
    const results = await normalizeImage({ bytes, mimeType: "image/jpeg" });
    expect(results.map((result) => result.variant)).toEqual(["original", "small", "large"]);
    const meta = await sharp(results[1].bytes).metadata();
    expect(meta.width).toBe(320);
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("webp");
    expect(results[1].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
