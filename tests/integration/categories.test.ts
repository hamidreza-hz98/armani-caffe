import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { createAdminSecurity } from "@/modules/auth/server";
import {
  createCategoryHttpHandler,
  createCategoryService,
} from "@/modules/catalog/categories/server";
import { MongoMediaRepository } from "@/modules/media/infrastructure/repository";
import * as categoryOrderMigration from "@/server/database/migrations/0006-category-order";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;
let time = new Date("2026-01-01T00:00:00.000Z");
const clock = () => new Date(time);
let category: ReturnType<typeof createCategoryService>;
let ownerToken: string;
let cashierToken: string;
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
    .createConnection(replica.getUri(isolatedResources("categories").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  await applyMigrations(connection, clock);
  const security = createAdminSecurity(
    connection,
    "category-admin-secret-longer-than-32-chars",
    clock,
  );
  const ownerPassword = "category-owner-password-12345";
  await security.repository.bootstrap(
    {
      username: "owner",
      displayName: "مالک",
      phone: "09123456789",
      password: ownerPassword,
      role: "OWNER",
    },
    await security.passwords.hash(ownerPassword),
    "bootstrap",
  );
  ownerToken = (
    await security.auth.login(
      { username: "owner", password: ownerPassword },
      null,
      "test-network",
      "owner-login",
    )
  ).token;
  const cashierPassword = "category-cashier-password-12345";
  await security.admins.create(
    ownerToken,
    {
      username: "cashier",
      displayName: "صندوق",
      phone: "09129999999",
      password: cashierPassword,
      role: "CASHIER",
    },
    "cashier-create",
  );
  cashierToken = (
    await security.auth.login(
      { username: "cashier", password: cashierPassword },
      null,
      "test-network",
      "cashier-login",
    )
  ).token;
  category = createCategoryService(
    connection,
    (token, capability, tx) => security.store.authorize(token, capability, tx),
    clock,
  );
});
beforeEach(async () => {
  time = new Date("2026-01-01T00:00:00.000Z");
  for (const name of [
    "categories",
    "products",
    "media_assets",
    "media_references",
    "media_receipts",
    "audit_events",
    "outbox_events",
  ])
    await connection.db!.collection(name).deleteMany({});
  await connection
    .db!.collection<{ _id: string; revision: number }>("category_order_guard")
    .updateOne({ _id: "catalog" }, { $set: { revision: 0 } });
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

test("owner CRUD creates unique Persian slugs and contiguous order", async () => {
  const first = await category.create(
    ownerToken,
    { name: "قهوهٔ عربی ۱۲۳", status: "published" },
    "c1",
  );
  const second = await category.create(
    ownerToken,
    { name: "قهوه عربی 123", status: "published" },
    "c2",
  );
  const third = await category.create(ownerToken, { name: "چای" }, "c3");
  expect(first.slug).toBe("قهوه-عربی-123");
  expect(second.slug).toBe("قهوه-عربی-123-2");
  expect([first.sortOrder, second.sortOrder, third.sortOrder]).toEqual([0, 1, 2]);
  const updated = await category.update(
    ownerToken,
    first.id,
    { revision: 0, name: "قهوه تازه", status: "draft" },
    "update",
  );
  expect(updated.slug).toBe(first.slug);
  expect(updated.status).toBe("draft");
  await category.delete(ownerToken, second.id, { revision: second.revision }, "delete");
  expect((await category.adminList(ownerToken)).items.map((item) => item.sortOrder)).toEqual([
    0, 1,
  ]);
  expect(
    await connection
      .db!.collection("categories")
      .countDocuments({ _id: new mongoose.Types.ObjectId(second.id), deletedAt: { $ne: null } }),
  ).toBe(1);
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "catalog.categories.changed" }),
  ).toBe(5);
});

test("public list excludes drafts/deleted categories and cashier only reads", async () => {
  await category.create(ownerToken, { name: "پنهان" }, "draft");
  const visible = await category.create(
    ownerToken,
    { name: "آشکار", status: "published" },
    "published",
  );
  expect((await category.publicList()).map((item) => item.id)).toEqual([visible.id]);
  expect((await category.adminList(cashierToken)).items).toHaveLength(2);
  await expect(category.create(cashierToken, { name: "نامجاز" }, "denied")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    category.update(cashierToken, visible.id, { revision: 0, status: "draft" }, "denied-update"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "catalog.categories.changed" }),
  ).toBe(2);
});

test("reorder is atomic, contiguous, and rejects stale concurrent revisions", async () => {
  const items = await Promise.all(
    ["الف", "ب", "ج"].map((name, i) =>
      category.create(ownerToken, { name, status: "published" }, `create-${i}`),
    ),
  );
  const revision = (await category.adminList(ownerToken)).orderRevision;
  const wanted = [items[2].id, items[0].id, items[1].id];
  const result = await category.reorder(ownerToken, { revision, ids: wanted }, "reorder");
  expect(result.items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  expect((await category.publicList()).map((item) => item.id)).toEqual(wanted);
  await expect(
    category.reorder(ownerToken, { revision, ids: wanted }, "stale"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const next = (await category.adminList(ownerToken)).orderRevision;
  const outcomes = await Promise.allSettled([
    category.reorder(
      ownerToken,
      { revision: next, ids: [items[0].id, items[1].id, items[2].id] },
      "race-a",
    ),
    category.reorder(
      ownerToken,
      { revision: next, ids: [items[1].id, items[2].id, items[0].id] },
      "race-b",
    ),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  expect(
    (outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult).reason,
  ).toMatchObject({ code: "CONFLICT" });
  const current = await category.adminList(ownerToken);
  expect(current.items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  expect(current.orderRevision).toBe(next + 1);
});

test("delete blocks live product dependencies and leaves no invalidation event", async () => {
  const item = await category.create(
    ownerToken,
    { name: "دارای محصول", status: "published" },
    "create",
  );
  await connection
    .db!.collection("products")
    .insertOne({ categoryId: new mongoose.Types.ObjectId(item.id), deletedAt: null });
  await expect(
    category.delete(ownerToken, item.id, { revision: item.revision }, "blocked"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "catalog.categories.changed" }),
  ).toBe(1);
  await connection.db!.collection("products").deleteMany({});
  await category.delete(ownerToken, item.id, { revision: item.revision }, "allowed");
  expect(await category.publicList()).toEqual([]);
});

test("media reference must be ready/public, blocks media deletion, and clears on update", async () => {
  const mediaId = new mongoose.Types.ObjectId();
  await connection.db!.collection("media_assets").insertOne({
    _id: mediaId,
    status: "ready",
    visibility: "private",
    deletedAt: null,
    referenceGuard: 0,
  });
  await expect(
    category.create(
      ownerToken,
      { name: "تصویر نامعتبر", mediaId: mediaId.toString() },
      "bad-media",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "catalog.categories.changed" }),
  ).toBe(0);
  await connection
    .db!.collection("media_assets")
    .updateOne({ _id: mediaId }, { $set: { visibility: "public" } });
  const item = await category.create(
    ownerToken,
    { name: "دارای تصویر", mediaId: mediaId.toString(), status: "published" },
    "good-media",
  );
  expect(
    await connection.db!.collection("media_references").countDocuments({
      mediaId,
      entityKind: "category",
      entityId: new mongoose.Types.ObjectId(item.id),
    }),
  ).toBe(1);
  const media = new MongoMediaRepository(
    connection,
    "test-media",
    "a".repeat(64),
    {
      usages: async () => [],
      replace: async () => {},
      productMediaIds: async () => [],
    },
    clock,
  );
  await expect(
    media.delete(
      { id: new mongoose.Types.ObjectId().toString(), role: "OWNER" },
      mediaId.toString(),
      "delete-key",
      "f".repeat(64),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const replacementId = new mongoose.Types.ObjectId();
  await connection.db!.collection("media_assets").insertOne({
    _id: replacementId,
    objectKey: "category-replacement",
    uploaderId: new mongoose.Types.ObjectId(),
    initiationKey: "replacement",
    status: "ready",
    visibility: "public",
    deletedAt: null,
    referenceGuard: 0,
  });
  await expect(
    media.replace(
      { id: new mongoose.Types.ObjectId().toString(), role: "OWNER" },
      mediaId.toString(),
      replacementId.toString(),
      "replace-key",
      "e".repeat(64),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await category.update(
    ownerToken,
    item.id,
    { revision: item.revision, mediaId: null },
    "clear-media",
  );
  expect(
    await connection
      .db!.collection("media_references")
      .countDocuments({ mediaId, entityKind: "category" }),
  ).toBe(0);
});

test("HTTP routes reject forged owner roles and cross-origin mutations", async () => {
  const handler = createCategoryHttpHandler({
    service: async () => category,
    token: (request) => request.headers.get("x-test-token"),
    origins: () => ["http://localhost:3000"],
  });
  const request = (token: string | null, origin: string) =>
    new Request("http://localhost:3000/api/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Admin-Role": "OWNER",
        ...(token ? { "X-Test-Token": token } : {}),
      },
      body: JSON.stringify({ name: "آزمایشی" }),
    });
  expect((await handler(request(null, "http://localhost:3000"), "create")).status).toBe(401);
  expect((await handler(request(cashierToken, "http://localhost:3000"), "create")).status).toBe(
    403,
  );
  expect((await handler(request(ownerToken, "https://evil.example"), "create")).status).toBe(403);
  expect((await handler(request(ownerToken, "http://localhost:3000"), "create")).status).toBe(200);
});

test("migration 6 compacts legacy order and backfills a safe media reference", async () => {
  const id = new mongoose.Types.ObjectId();
  const mediaId = new mongoose.Types.ObjectId();
  await connection.db!.collection("media_assets").insertOne({
    _id: mediaId,
    status: "ready",
    visibility: "public",
    deletedAt: null,
    referenceGuard: 0,
  });
  await connection.db!.collection("categories").insertOne({
    _id: id,
    name: "قدیمی",
    slug: "old",
    status: "published",
    sortOrder: 8,
    mediaId,
    deletedAt: null,
    createdAt: time,
    updatedAt: time,
    __v: 0,
  });
  await connection.transaction((tx) => categoryOrderMigration.up(connection.db!, tx, time));
  expect(await connection.db!.collection("categories").findOne({ _id: id })).toMatchObject({
    sortOrder: 0,
    __v: 1,
  });
  expect(
    await connection
      .db!.collection("media_references")
      .countDocuments({ entityKind: "category", entityId: id, mediaId }),
  ).toBe(1);
  expect(
    (await connection.db!.collection("media_assets").findOne({ _id: mediaId }))!.referenceGuard,
  ).toBe(1);
});
