import { randomBytes } from "node:crypto";

import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test } from "vitest";

import { MinioMediaStorage } from "../../src/modules/media/server.ts";
import { createMinioClient } from "../../src/server/minio/index.ts";
import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation.ts";

const endpoint = process.env.MINIO_TEST_ENDPOINT ?? "http://127.0.0.1:9000";
const bucket = isolatedResources("media").minioBucket;
const client = createMinioClient({
  endpoint,
  region: "us-east-1",
  accessKey: process.env.MINIO_TEST_ACCESS_KEY ?? "armani_dev",
  secretKey: process.env.MINIO_TEST_SECRET_KEY ?? "armani_dev_password_change_me",
});
const storage = new MinioMediaStorage(client, bucket, "test-only-ticket-key-".repeat(3));
const owner = "000000000000000000000001";
let created = false;
let bytes: Buffer;

beforeAll(async () => {
  Object.assign(process.env, testEnv());
  try {
    const response = await fetch(new URL("/minio/health/ready", endpoint), {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error("MinIO is not ready");
  } catch {
    throw new Error(
      "Real MinIO is required. Start the local MinIO service or set MINIO_TEST_ENDPOINT/ACCESS_KEY/SECRET_KEY for a dedicated test server. Tests never use the development bucket.",
    );
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  created = true;
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "staging",
            Status: "Enabled",
            Filter: { Prefix: "staging/" },
            Expiration: { Days: 1 },
          },
          {
            ID: "multipart",
            Status: "Enabled",
            Filter: { Prefix: "" },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    }),
  );
  bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#d9b88b" } })
    .jpeg()
    .toBuffer();
});

afterAll(async () => {
  try {
    if (!created) return;
    // The only destructive target is the randomly generated test bucket created above.
    if (!bucket.startsWith("armani-test-")) throw new Error("Unsafe test cleanup target");
    const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    if (objects.Contents?.length)
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.Contents.map((object) => ({ Key: object.Key! })) },
        }),
      );
    const incomplete = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
    for (const upload of incomplete.Uploads ?? [])
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  } finally {
    client.destroy();
  }
});

test("private upload, normalized variants, metadata, signed reads and deletion", async () => {
  await storage.health();
  const image = await storage.upload(owner, { bytes, mimeType: "image/jpeg" });
  expect(image.objects).toHaveLength(3);
  const key = image.objects[1].key;
  const stat = await storage.metadata(owner, key);
  expect(stat.mimeType).toBe("image/webp");
  const result = await storage.read(owner, key);
  expect((await sharp(result).metadata()).width).toBe(320);
  expect((await fetch(`${endpoint}/${bucket}/${key}`)).status).toBe(403);
  expect((await fetch(`${endpoint}/${bucket}?list-type=2`)).status).toBe(403);
  const url = await storage.downloadUrl(owner, key);
  expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("120");
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(storage.read("000000000000000000000002", key)).rejects.toThrow();
  await storage.delete(
    owner,
    image.objects.map((object) => object.key),
  );
  await expect(storage.metadata(owner, key)).rejects.toThrow();
});

async function postUpload(
  ticket: Awaited<ReturnType<typeof storage.prepareUpload>>,
  data: Uint8Array,
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
  form.append(
    "file",
    new Blob([new Uint8Array(data)], { type: ticket.fields["Content-Type"] }),
    "untrusted-name.exe",
  );
  return fetch(ticket.url, { method: "POST", body: form });
}

test("signed staging enforces size and type, validation promotes and rejection cleans up", async () => {
  const ticket = await storage.prepareUpload(owner, bytes.length, "image/jpeg");
  expect((await postUpload(ticket, bytes)).ok).toBe(true);
  await expect(storage.read(owner, ticket.fields.key)).rejects.toThrow();
  await expect(storage.finalizeUpload("000000000000000000000002", ticket.token)).rejects.toThrow();
  expect((await storage.finalizeUpload(owner, ticket.token)).objects).toHaveLength(3);
  await expect(storage.finalizeUpload(owner, ticket.token)).rejects.toThrow();
  const wrong = await storage.prepareUpload(owner, bytes.length, "image/png");
  expect((await postUpload(wrong, bytes)).ok).toBe(true);
  await expect(storage.finalizeUpload(owner, wrong.token)).rejects.toThrow();
  const tooBig = await storage.prepareUpload(owner, 10, "image/jpeg");
  expect((await postUpload(tooBig, bytes)).ok).toBe(false);
  const cancel = await storage.prepareUpload(owner, bytes.length, "image/jpeg");
  await postUpload(cancel, bytes);
  await storage.cancelUpload(owner, cancel.token);
  const remaining = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "staging/" }),
  );
  expect(remaining.KeyCount).toBe(0);
});

test("bulk returns partial results and a failed variant removes uploaded siblings", async () => {
  const results = await storage.uploadBulk(owner, [
    { bytes, mimeType: "image/jpeg" },
    { bytes, mimeType: "image/png" },
  ]);
  expect(results.map((result) => result.ok)).toEqual([true, false]);
  const before = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "media/" }));
  client.middlewareStack.add(
    (next, context) => async (args) => {
      const input = args.input as { Key?: string };
      if (context.commandName === "PutObjectCommand" && input.Key?.endsWith("-small.webp"))
        throw new Error("Injected variant failure");
      return next(args);
    },
    { step: "initialize", name: "failVariant" },
  );
  try {
    await expect(storage.upload(owner, { bytes, mimeType: "image/jpeg" })).rejects.toThrow();
  } finally {
    client.middlewareStack.remove("failVariant");
  }
  const after = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "media/" }));
  expect(after.KeyCount).toBe(before.KeyCount);
});

test("large images use S3 multipart and interrupted multipart transfers are aborted", async () => {
  const noise = await sharp(randomBytes(3500 * 3500 * 3), {
    raw: { width: 3500, height: 3500, channels: 3 },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  let parts = 0;
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName === "UploadPartCommand") parts += 1;
      return next(args);
    },
    { step: "initialize", name: "countParts" },
  );
  try {
    await storage.upload(owner, { bytes: noise, mimeType: "image/jpeg" });
  } finally {
    client.middlewareStack.remove("countParts");
  }
  expect(parts).toBeGreaterThanOrEqual(2);
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName === "UploadPartCommand")
        throw new Error("Injected multipart interruption");
      return next(args);
    },
    { step: "initialize", name: "failParts" },
  );
  try {
    await expect(storage.upload(owner, { bytes: noise, mimeType: "image/jpeg" })).rejects.toThrow();
  } finally {
    client.middlewareStack.remove("failParts");
  }
  expect(
    (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket }))).Uploads ?? [],
  ).toHaveLength(0);
});
