import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import {
  productMediaIds,
  productMediaUsages,
  productSchema,
  replaceProductMedia,
} from "../../src/modules/catalog/products/server.ts";
import { MongoMediaRepository } from "../../src/modules/media/infrastructure/repository.ts";
import {
  createMediaActions,
  createMediaHttpHandler,
  MediaService,
} from "../../src/modules/media/server.ts";
import * as mediaMigration from "../../src/server/database/migrations/0002-media-workflows.ts";
import { applyDatabaseIndexes } from "../../src/server/database/operations.ts";
import { testEnv } from "../fixtures/config.mjs";
import { FakeMediaStorage } from "../fixtures/FakeMediaStorage.ts";
import { isolatedResources } from "../fixtures/isolation.ts";

let replica: MongoMemoryReplSet;
function createMediaRepository(
  connection: mongoose.Connection,
  bucket: string,
  key: string,
  clock: () => Date,
) {
  return new MongoMediaRepository(
    connection,
    bucket,
    key,
    {
      usages: (session, id) => productMediaUsages(connection, session, id),
      replace: (session, from, to) => replaceProductMedia(connection, session, from, to),
      productMediaIds: (session, id) => productMediaIds(connection, session, id),
    },
    clock,
  );
}
let connection: mongoose.Connection;
let repository: ReturnType<typeof createMediaRepository>;
let service: MediaService;
const storage = new FakeMediaStorage();
const owner = { id: "000000000000000000000001", role: "OWNER" as const };
const cashier = { id: "000000000000000000000002", role: "CASHIER" as const };
let timestamp = new Date();
const now = () => new Date(timestamp);
const metadata = (visibility: "public" | "private" = "private", title = "قهوه") => ({
  title,
  altText: "فنجان قهوه",
  caption: "تصویر منو",
  visibility,
  seo: { title: "قهوه", description: "تصویر قهوه", keywords: ["قهوه"] },
});
const input = (visibility: "public" | "private" = "private") => ({
  filename: "coffee.jpg",
  mimeType: "image/jpeg",
  byteSize: 123,
  metadata: metadata(visibility),
});

beforeAll(async () => {
  Object.assign(process.env, testEnv());
  const installed = "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe";
  const systemBinary =
    process.env.MONGOMS_SYSTEM_BINARY ??
    (process.platform === "win32" && existsSync(installed) ? installed : undefined);
  const version = systemBinary
    ? /db version v(\d+\.\d+\.\d+)/.exec(
        execFileSync(systemBinary, ["--version"], { encoding: "utf8" }),
      )?.[1]
    : undefined;
  replica = await MongoMemoryReplSet.create({
    binary: systemBinary ? { systemBinary, ...(version ? { version } : {}) } : undefined,
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  connection = await mongoose
    .createConnection(replica.getUri(isolatedResources("media-app").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  repository = createMediaRepository(connection, "armani-test-module", "1".repeat(64), now);
  service = new MediaService(repository, storage, now);
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

async function ready(key: string, visibility: "public" | "private" = "private") {
  const upload = await service.initiate(owner, key, input(visibility));
  return service.complete(owner, upload.id);
}

test("initiation and duplicate completion persist decoded metadata exactly once", async () => {
  const first = await service.initiate(owner, "init-duplicate", input());
  const repeat = await service.initiate(owner, "init-duplicate", input());
  expect(repeat.id).toBe(first.id);
  expect(repeat.upload?.fields.key).toBe(first.upload?.fields.key);
  await expect(
    service.initiate(owner, "init-duplicate", { ...input(), filename: "other.jpg" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const calls = storage.finalizations;
  const asset = await service.complete(owner, first.id);
  expect(await service.complete(owner, first.id)).toEqual(asset);
  expect(storage.finalizations).toBe(calls + 1);
  expect(asset).toMatchObject({
    status: "ready",
    filename: "coffee.jpg",
    mimeType: "image/webp",
    byteSize: 100,
    width: 640,
    height: 480,
    uploaderId: owner.id,
  });
  expect(asset.variants).toHaveLength(3);
  const raw = await connection
    .db!.collection("media_assets")
    .findOne({ _id: new mongoose.Types.ObjectId(asset.id) });
  expect(raw?.ticketCiphertext).not.toContain("Content-Type");
  expect(JSON.stringify(asset)).not.toMatch(/token|Ciphertext|storage\.test|objectKey/);
  await service.cleanup();
  expect(storage.stages.has(first.upload!.fields.key)).toBe(false);
});

test("permission checks distinguish public reads, private assets and OWNER-only mutation", async () => {
  const pub = await ready("public-example", "public");
  const priv = await ready("private-example");
  const publicValue = await service.detail(null, pub.id);
  expect(publicValue.filename).toBeUndefined();
  expect(publicValue.uploaderId).toBeUndefined();
  await expect(service.detail(null, priv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.detail(cashier, priv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.initiate(null, "anonymous-upload", input())).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(service.initiate(cashier, "cashier-upload", input())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(service.complete(cashier, pub.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(() =>
    service.update(cashier, pub.id, "cashier-update", pub.revision, metadata()),
  ).toThrow();
  expect(() => service.delete(cashier, pub.id, "cashier-delete")).toThrow();
  expect(() => service.replace(cashier, pub.id, priv.id, "cashier-replace")).toThrow();
  await expect(service.readFile(null, priv.id, "small")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect((await service.readFile(null, pub.id, "small")).bytes.length).toBe(3);
  const list = await service.list(
    null,
    new URLSearchParams("visibility=private&status=pending&pageSize=100"),
  );
  expect(list.items.every((item) => item.status === "ready" && item.visibility === "public")).toBe(
    true,
  );
});

test("metadata validation, optimistic versions and mutation receipts", async () => {
  const asset = await ready("metadata-example");
  expect(() =>
    service.update(owner, asset.id, "metadata-invalid", asset.revision, {
      ...metadata(),
      altText: "<script>",
    }),
  ).toThrow();
  const updated = await service.update(
    owner,
    asset.id,
    "metadata-update",
    asset.revision,
    metadata("public", "قهوهٔ تازه"),
  );
  expect(updated.revision).toBe(asset.revision + 1);
  expect(
    await service.update(
      owner,
      asset.id,
      "metadata-update",
      asset.revision,
      metadata("public", "قهوهٔ تازه"),
    ),
  ).toEqual(updated);
  await expect(
    service.update(owner, asset.id, "metadata-stale", asset.revision, metadata()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.update(owner, asset.id, "metadata-update", asset.revision, metadata()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("in-use deletion is blocked and replacement rewrites real product references atomically", async () => {
  const old = await ready("referenced-old", "public");
  const replacement = await ready("referenced-new", "public");
  const products = connection.models.Product ?? connection.model("Product", productSchema);
  const productId = new mongoose.Types.ObjectId();
  await repository.syncProductReferences(String(productId), [old.id], async (session) => {
    await products.create(
      [
        {
          _id: productId,
          name: "قهوه",
          slug: "coffee-referenced",
          categoryId: new mongoose.Types.ObjectId(),
          basePriceToman: 50_000,
          sortOrder: 0,
          mediaIds: [old.id],
        },
      ],
      { session },
    );
  });
  expect(await service.usages(owner, old.id)).toEqual([
    { entityKind: "product", entityId: String(productId), field: "mediaIds" },
  ]);
  await expect(service.delete(owner, old.id, "delete-in-use")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    service.update(owner, old.id, "hide-in-use", old.revision, metadata()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const result = await service.replace(owner, old.id, replacement.id, "replace-in-use");
  expect(result.status).toBe("deleted");
  expect(await service.replace(owner, old.id, replacement.id, "replace-in-use")).toEqual(result);
  const product = await products.findById(productId).lean();
  expect((product as { mediaIds: mongoose.Types.ObjectId[] }).mediaIds.map(String)).toEqual([
    replacement.id,
  ]);
  expect(await service.usages(owner, old.id)).toHaveLength(0);
  await expect(service.delete(owner, replacement.id, "delete-still-used")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await repository.syncProductReferences(String(productId), [], async (session) => {
    await products.updateOne({ _id: productId }, { $set: { mediaIds: [] } }, { session });
  });
  expect((await service.delete(owner, replacement.id, "delete-now-unused")).status).toBe("deleted");
});

test("media usage endpoint rejects an oversized reference set instead of returning a partial list", async () => {
  const asset = await ready("usage-cap-example", "public");
  await connection.db!.collection("products").insertMany(
    Array.from({ length: 101 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      slug: `usage-cap-${index}`,
      mediaIds: [new mongoose.Types.ObjectId(asset.id)],
      deletedAt: null,
    })),
  );
  await expect(service.usages(owner, asset.id)).rejects.toMatchObject({ code: "CONFLICT" });
});

test("replacement updates addition images and parent revision without changing addition price", async () => {
  const from = await ready("addition-image-old", "public"),
    to = await ready("addition-image-new", "public");
  const product = await connection.models.Product.create({
    name: "اضافه",
    slug: "addition-parent",
    categoryId: new mongoose.Types.ObjectId(),
    basePriceToman: 50000,
    sortOrder: 0,
    mediaIds: [],
  });
  const additionId = new mongoose.Types.ObjectId();
  await connection.db!.collection("product_additions").insertOne({
    _id: additionId,
    productId: product._id,
    name: "شیر",
    priceToman: 10000,
    mediaId: new mongoose.Types.ObjectId(from.id),
    available: true,
    sortOrder: 0,
    __v: 0,
  });
  expect(await service.usages(owner, from.id)).toEqual([
    { entityKind: "product", entityId: String(product._id), field: "additionMediaIds" },
  ]);
  await expect(service.delete(owner, from.id, "addition-image-delete")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await service.replace(owner, from.id, to.id, "addition-image-replace");
  const addition = await connection
    .db!.collection("product_additions")
    .findOne({ _id: additionId });
  expect(String(addition!.mediaId)).toBe(to.id);
  expect(addition!.priceToman).toBe(10000);
  expect((await connection.models.Product.findById(product._id)).__v).toBe(product.__v + 1);
});

test("raw legacy product links block deletion and failed replacement rolls back", async () => {
  const old = await ready("legacy-link-old", "public");
  const next = await ready("legacy-link-new", "public");
  const products = connection.models.Product;
  const product = await products.create({
    name: "قهوه",
    slug: "legacy-link",
    categoryId: new mongoose.Types.ObjectId(),
    basePriceToman: 50_000,
    sortOrder: 0,
    mediaIds: [old.id],
  });
  await expect(service.delete(owner, old.id, "delete-legacy-link")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const failed = new MediaService(
    createMediaRepository(connection, "armani-test-module", "1".repeat(64), now),
    storage,
    now,
  );
  const repositorySpy = vi
    .spyOn(Object.getPrototypeOf(connection.db!.collection("products")), "updateOne")
    .mockImplementationOnce(() => {
      throw new Error("Injected reference failure");
    });
  await expect(failed.replace(owner, old.id, next.id, "replace-rollback")).rejects.toThrow();
  repositorySpy.mockRestore();
  expect((await service.detail(owner, old.id)).status).toBe("ready");
  expect((await products.findById(product._id)).mediaIds.map(String)).toEqual([old.id]);
});

test("reference attachment and deletion races cannot commit a dangling product image", async () => {
  const asset = await ready("reference-delete-race");
  const productId = new mongoose.Types.ObjectId();
  const outcomes = await Promise.allSettled([
    repository.syncProductReferences(String(productId), [asset.id], async (session) => {
      await connection.models.Product.create(
        [
          {
            _id: productId,
            name: "قهوه",
            slug: "reference-race",
            categoryId: new mongoose.Types.ObjectId(),
            basePriceToman: 40_000,
            sortOrder: 0,
            mediaIds: [asset.id],
          },
        ],
        { session },
      );
    }),
    service.delete(owner, asset.id, "reference-race-delete"),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  const stored = await connection.models.Product.findById(productId).lean();
  if (stored) expect((await service.detail(owner, asset.id)).status).toBe("ready");
  else expect((await service.detail(owner, asset.id)).status).toBe("deleted");
});

test("partial bulk completion and failed persistence recover without re-encoding", async () => {
  const initiated = await service.initiateBulk(owner, "partial-bulk-init", [
    input(),
    { ...input(), filename: "../bad.jpg" },
    input(),
  ]);
  expect(initiated.map((result) => result.ok)).toEqual([true, false, true]);
  const successful = initiated.filter((result) => result.ok).map((result) => result.value!.id);
  const bad = await service.initiate(owner, "bad-byte-upload", input());
  storage.invalidStages.add(bad.upload!.fields.key);
  const completed = await service.completeBulk(owner, [successful[0], bad.id, successful[1]]);
  expect(completed.map((result) => result.ok)).toEqual([true, false, true]);
  const retry = await service.initiate(owner, "recover-db-write", input());
  const count = storage.finalizations;
  vi.spyOn(repository, "finishCompletion").mockRejectedValueOnce(
    new Error("Injected database interruption"),
  );
  await expect(service.complete(owner, retry.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await service.complete(owner, retry.id)).status).toBe("ready");
  expect(storage.finalizations).toBe(count + 1);
});

test("duplicate claims, expired uploads, durable cleanup failure and retry", async () => {
  const initiated = await service.initiate(owner, "claim-concurrency", input());
  const claims = await Promise.all([
    repository.claimCompletion(initiated.id),
    repository.claimCompletion(initiated.id),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await repository.failCompletion(claims.find(Boolean)!, false);
  const asset = await service.complete(owner, initiated.id);
  const deletion = await service.delete(owner, asset.id, "cleanup-delete");
  expect(await service.delete(owner, asset.id, "cleanup-delete")).toEqual(deletion);
  storage.failDeletion = true;
  expect((await service.cleanup()).failed).toBeGreaterThan(0);
  storage.failDeletion = false;
  timestamp = new Date(timestamp.getTime() + 60_000);
  await service.cleanup();
  expect(storage.outputs.has(asset.objectVersion!)).toBe(false);
  const abandoned = await service.initiate(owner, "abandoned-upload", input());
  const record = await repository.uploadRecord(abandoned.id);
  // Simulate bytes written before the process crashed; the DB intent already exists.
  await storage.finalizeUpload(owner.id, record!.ticket.token, record!.objectVersion);
  timestamp = new Date(timestamp.getTime() + 16 * 60_000);
  expect((await service.cleanup()).expired).toBeGreaterThan(0);
  expect(storage.outputs.has(record!.objectVersion)).toBe(false);
  expect((await service.detail(owner, abandoned.id)).status).toBe("rejected");
});

test("list projections are minimal and public browse/search use declared indexes", async () => {
  const list = await service.list(
    null,
    new URLSearchParams("q=قهوه&sort=createdAt&direction=asc&pageSize=2"),
  );
  expect(list.items.length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(list.items)).not.toMatch(
    /ticket|objectKey|ownerId|uploaderId|variants|seo/,
  );
  const explained = await connection.models.MediaAsset.find({
    status: "ready",
    visibility: "public",
  })
    .sort({ createdAt: 1, _id: 1 })
    .explain("queryPlanner");
  expect(JSON.stringify(explained)).toContain("media_browse_createdAt");
  const search = await connection.models.MediaAsset.find({
    $text: { $search: "قهوه", $language: "none" },
  }).explain("queryPlanner");
  expect(JSON.stringify(search)).toContain("media_search");
});

test("HTTP/action contracts enforce authentication, CSRF and safe error envelopes", async () => {
  let actor: typeof owner | typeof cashier | null = null;
  let serviceCalls = 0;
  const handle = createMediaHttpHandler({
    service: async () => {
      serviceCalls += 1;
      return service;
    },
    authenticate: async () => actor,
    origins: () => ["http://localhost:3000"],
  });
  const request = (body: unknown, origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Idempotency-Key": "http-new-media",
      },
      body: JSON.stringify(body),
    });
  expect((await handle(request(input()), "initiate")).status).toBe(401);
  expect(serviceCalls).toBe(0);
  actor = cashier;
  expect((await handle(request(input()), "initiate")).status).toBe(403);
  actor = owner;
  expect((await handle(request(input(), "http://evil.invalid"), "initiate")).status).toBe(403);
  const response = await handle(request(input()), "initiate");
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.ok).toBe(true);
  const actions = createMediaActions(service, async () => cashier);
  expect(await actions.complete(result.value.id)).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN", message: "اجازهٔ انجام این کار را ندارید." },
  });
  const invalid = await handle(request({ ...input(), actor: owner }), "initiate");
  expect(invalid.status).toBe(400);
  expect(invalid.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
});

test("explicit media migration quarantines legacy records without touching their objects", async () => {
  const id = new mongoose.Types.ObjectId();
  await connection.db!.collection("media_assets").insertOne({
    _id: id,
    ownerId: new mongoose.Types.ObjectId(owner.id),
    objectKey: "legacy/unsafe-name",
    bucket: "legacy",
    mimeType: "image/jpeg",
    byteSize: 10,
    sha256: "a".repeat(64),
    status: "ready",
    createdAt: now(),
    updatedAt: now(),
    __v: 0,
  });
  // This suite intentionally contains orphan legacy product fixtures; test only media rollout.
  await connection.transaction((tx) => mediaMigration.up(connection.db!, tx, now()));
  const migrated = await connection.db!.collection("media_assets").findOne({ _id: id });
  await connection.transaction((tx) => mediaMigration.up(connection.db!, tx, now()));
  expect(await connection.db!.collection("media_assets").findOne({ _id: id })).toEqual(migrated);
  const record = await connection.db!.collection("media_assets").findOne({ _id: id });
  expect(record).toMatchObject({
    status: "rejected",
    visibility: "private",
    objectKey: "legacy/unsafe-name",
    legacyReviewRequired: true,
  });
  await expect(service.delete(owner, String(id), "delete-legacy-media")).rejects.toMatchObject({
    code: "CONFLICT",
  });
});
