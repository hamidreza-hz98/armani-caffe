import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { logEvent } from "../../../server/observability/index.ts";
import type { MediaStorage, StoredImage, UploadInput } from "../application/storage.ts";
import {
  assertOwnedKey,
  assertOwnerId,
  MAX_MEDIA_BYTES,
  mediaKey,
  stagingKey,
  validateMediaInput,
} from "../domain/storage-policy.ts";
import { normalizeImage } from "./images.ts";

const expirySeconds = 120;
type Ticket = {
  key: string;
  ownerId: string;
  byteSize: number;
  mimeType: string;
  expiresAt: number;
};

export class MinioMediaStorage implements MediaStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signingKey: string;
  private readonly now: () => number;
  constructor(client: S3Client, bucket: string, signingKey: string, now = Date.now) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || signingKey.length < 32)
      throw new RangeError("Invalid private storage configuration");
    this.client = client;
    this.bucket = bucket;
    this.signingKey = signingKey;
    this.now = now;
  }
  private sign(payload: string): Buffer {
    return createHmac("sha256", this.signingKey).update(`media-upload-v1:${payload}`).digest();
  }
  private ticket(ownerId: string, token: string): Ticket {
    if (token.length > 2048) throw new RangeError("Invalid upload ticket");
    const parts = token.split(".");
    const payload = parts[0] ?? "";
    const signature = Buffer.from(parts[1] ?? "", "base64url");
    const expected = this.sign(payload);
    if (
      parts.length !== 2 ||
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      throw new RangeError("Invalid upload ticket");
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString()) as Ticket;
    assertOwnedKey(ticket.key, ownerId, true);
    validateMediaInput(ticket.byteSize, ticket.mimeType);
    if (
      ticket.ownerId !== ownerId ||
      !Number.isFinite(ticket.expiresAt) ||
      ticket.expiresAt < this.now()
    )
      throw new RangeError("Expired or unauthorized upload ticket");
    return ticket;
  }
  async upload(ownerId: string, input: UploadInput): Promise<StoredImage> {
    assertOwnerId(ownerId);
    const variants = await normalizeImage(input);
    const id = randomUUID();
    const keys: string[] = [];
    const objects: StoredImage["objects"][number][] = [];
    try {
      for (const variant of variants) {
        const key = mediaKey(ownerId, id, variant.sha256, variant.variant);
        keys.push(key);
        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: this.bucket,
            Key: key,
            Body: variant.bytes,
            ContentType: "image/webp",
            CacheControl: "private, max-age=31536000, immutable",
            ContentDisposition: "inline",
            Metadata: { sha256: variant.sha256 },
          },
          partSize: 5 * 1024 * 1024,
          queueSize: 2,
          leavePartsOnError: false,
        });
        const timer = setTimeout(() => {
          void upload.abort();
        }, 30_000);
        try {
          await upload.done();
        } finally {
          clearTimeout(timer);
        }
        objects.push({
          key,
          variant: variant.variant,
          byteSize: variant.bytes.length,
          sha256: variant.sha256,
          mimeType: "image/webp",
        });
      }
      return { id, objects };
    } catch (error) {
      const cleanup = await Promise.allSettled(keys.map((key) => this.removeKey(key)));
      cleanup.forEach((result, index) => {
        if (result.status === "rejected")
          logEvent("error", "media.cleanup_required", { key: keys[index], uploadId: id });
      });
      throw error;
    }
  }
  async uploadBulk(ownerId: string, inputs: readonly UploadInput[]) {
    assertOwnerId(ownerId);
    if (!inputs.length || inputs.length > 5) throw new RangeError("Bulk upload accepts 1–5 images");
    const results: ({ ok: true; image: StoredImage } | { ok: false; code: "UPLOAD_FAILED" })[] = [];
    for (const input of inputs) {
      try {
        results.push({ ok: true, image: await this.upload(ownerId, input) });
      } catch {
        results.push({ ok: false, code: "UPLOAD_FAILED" });
      }
    }
    return results;
  }
  async prepareUpload(ownerId: string, byteSize: number, mimeType: string) {
    validateMediaInput(byteSize, mimeType);
    const key = stagingKey(ownerId, randomUUID());
    const policy = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Expires: expirySeconds,
      Fields: { "Content-Type": mimeType, "Cache-Control": "no-store" },
      Conditions: [
        ["content-length-range", byteSize, byteSize],
        ["eq", "$Content-Type", mimeType],
        ["eq", "$Cache-Control", "no-store"],
      ],
    });
    const ticket: Ticket = {
      key,
      ownerId,
      byteSize,
      mimeType,
      expiresAt: this.now() + 15 * 60_000,
    };
    const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
    return {
      token: `${payload}.${this.sign(payload).toString("base64url")}`,
      ...policy,
      expiresIn: expirySeconds,
    };
  }
  async finalizeUpload(ownerId: string, token: string): Promise<StoredImage> {
    const ticket = this.ticket(ownerId, token);
    let image: StoredImage | undefined;
    try {
      const stat = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: ticket.key }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
      if (stat.ContentLength !== ticket.byteSize)
        throw new RangeError("Uploaded size differs from ticket");
      const bytes = await this.readKey(ticket.key);
      image = await this.upload(ownerId, { bytes, mimeType: ticket.mimeType });
    } finally {
      try {
        await this.removeKey(ticket.key);
      } catch {
        logEvent("error", "media.staging_cleanup_required", { key: ticket.key });
      }
    }
    return image;
  }
  async cancelUpload(ownerId: string, token: string): Promise<void> {
    await this.removeKey(this.ticket(ownerId, token).key);
  }
  private async readKey(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    if (!response.Body) throw new Error("Missing object body");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_MEDIA_BYTES) {
        (response.Body as { destroy?: () => void }).destroy?.();
        throw new RangeError("Object exceeds media size limit");
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async read(ownerId: string, key: string) {
    assertOwnedKey(key, ownerId);
    return this.readKey(key);
  }
  async metadata(ownerId: string, key: string) {
    assertOwnedKey(key, ownerId);
    const stat = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
    return {
      byteSize: stat.ContentLength ?? 0,
      mimeType: stat.ContentType ?? "application/octet-stream",
      etag: stat.ETag ?? "",
      lastModified: stat.LastModified ?? new Date(0),
    };
  }
  async downloadUrl(ownerId: string, key: string) {
    assertOwnedKey(key, ownerId);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseCacheControl: "private, no-store",
        ResponseContentType: "image/webp",
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: expirySeconds },
    );
  }
  private async removeKey(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
  }
  async delete(ownerId: string, keys: readonly string[]) {
    if (keys.length > 15) throw new RangeError("Too many media objects");
    keys.forEach((key) => assertOwnedKey(key, ownerId));
    const results = await Promise.allSettled(keys.map((key) => this.removeKey(key)));
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Media deletion incomplete; retry the same keys safely");
  }
  async health() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(2500),
    });
  }
}
