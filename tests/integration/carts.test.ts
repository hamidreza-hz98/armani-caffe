import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { createCustomerSecurity } from "@/modules/auth/server";
import { createCartHttpHandler, createCartService } from "@/modules/carts/server";
import { productPricingProjection } from "@/modules/catalog/products/server";
import { composeCartService } from "@/server/commerce/carts";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet, connection: mongoose.Connection;
let time = new Date("2026-01-01T00:00:00Z");
const clock = () => new Date(time),
  secret = "isolated-customer-cart-secret-longer-than-32";
let security: ReturnType<typeof createCustomerSecurity>,
  carts: ReturnType<typeof composeCartService>;
let token: string, otherToken: string, secondToken: string;
const productId = new mongoose.Types.ObjectId(),
  additionId = new mongoose.Types.ObjectId(),
  categoryId = new mongoose.Types.ObjectId();
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
    .createConnection(replica.getUri(isolatedResources("carts").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  await applyMigrations(connection, clock);
  security = createCustomerSecurity(connection, secret, clock);
  carts = composeCartService(connection, secret, clock);
  const password = "customer-cart-password-12345";
  for (const phone of ["09123456789", "09129999999"])
    await security.auth.signup({ phone, password }, "signup");
  token = (await security.auth.login({ phone: "09123456789", password }, null, "login")).token;
  secondToken = (await security.auth.login({ phone: "09123456789", password }, null, "login-2"))
    .token;
  otherToken = (await security.auth.login({ phone: "09129999999", password }, null, "login-other"))
    .token;
});
beforeEach(async () => {
  time = new Date("2026-01-01T00:00:00Z");
  for (const name of [
    "carts",
    "products",
    "product_additions",
    "categories",
    "inventory_items",
    "product_consumption_rules",
  ])
    await connection.db!.collection(name).deleteMany({});
  await connection
    .db!.collection("categories")
    .insertOne({ _id: categoryId, name: "قهوه", status: "published", deletedAt: null });
  await connection.db!.collection("products").insertOne({
    _id: productId,
    categoryId,
    name: "لاته",
    basePriceToman: 100000,
    status: "published",
    available: true,
    deletedAt: null,
  });
  await connection
    .db!.collection("product_additions")
    .insertOne({ _id: additionId, productId, name: "شیر", priceToman: 10000, available: true });
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  if (replica) await replica.stop();
});
const versionOf = (cart: { id: string; revision: number }) => ({
  cartId: cart.id,
  revision: cart.revision,
});
const add = (
  cart: { id: string; revision: number },
  quantity = 2,
  additionIds = [String(additionId)],
) =>
  carts.mutate(token, {
    operation: "add",
    ...versionOf(cart),
    productId: String(productId),
    quantity,
    additionIds,
  });

test("per-product note persists across pricing and quantity changes", async () => {
  let cart = await carts.read(token);
  cart = await carts.mutate(token, {
    operation: "add",
    ...versionOf(cart),
    productId: String(productId),
    additionIds: [String(additionId)],
    quantity: 1,
    note: "کم‌شیرین",
  });
  expect(cart.items[0].note).toBe("کم‌شیرین");
  cart = await add(cart, 1);
  expect(cart.items[0].note).toBe("کم‌شیرین");
  cart = await carts.mutate(token, {
    operation: "update",
    ...versionOf(cart),
    itemKey: String(productId) + ":" + additionId,
    additionIds: [String(additionId)],
    quantity: 2,
    note: "بدون یخ",
  });
  expect((await carts.read(token)).items[0]).toMatchObject({ quantity: 2, note: "بدون یخ" });
});

test("one cart across sessions, exact server pricing, update/merge/remove and notes", async () => {
  const empty = await carts.read(token);
  expect((await carts.read(secondToken)).id).toBe(empty.id);
  let cart = await add(empty);
  expect(cart.pricing).toEqual({
    subtotalToman: 220000,
    discountToman: 0,
    deliveryToman: 0,
    totalToman: 220000,
  });
  expect(JSON.stringify(cart)).not.toMatch(/passwordHash|tokenHash|customerId|phone/);
  cart = await add(cart, 1);
  expect(cart.items).toHaveLength(1);
  expect(cart.items[0].quantity).toBe(3);
  cart = await carts.mutate(token, {
    operation: "update",
    ...versionOf(cart),
    itemKey: String(productId) + ":" + additionId,
    additionIds: [],
    quantity: 4,
  });
  expect(cart.pricing.totalToman).toBe(400000);
  cart = await carts.mutate(token, { operation: "notes", ...versionOf(cart), notes: " بدون شکر " });
  expect(cart.notes).toBe("بدون شکر");
  cart = await carts.mutate(token, {
    operation: "remove",
    ...versionOf(cart),
    itemKey: String(productId),
  });
  expect(cart.items).toEqual([]);
  expect(cart.checkoutReady).toBe(false);
});
test("QR table selection persists on the active cart with optimistic revision protection", async () => {
  const empty = await carts.read(token);
  expect(empty.tableNumber).toBeNull();
  const selected = await carts.mutate(token, {
    operation: "table",
    ...versionOf(empty),
    tableNumber: 3,
  });
  expect(selected.tableNumber).toBe(3);
  expect((await carts.read(secondToken)).tableNumber).toBe(3);
  await expect(
    carts.mutate(secondToken, { operation: "table", ...versionOf(empty), tableNumber: 4 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await connection
        .db!.collection("carts")
        .findOne({ _id: new mongoose.Types.ObjectId(empty.id) })
    )?.tableNumber,
  ).toBe(3);
});
test("strict inputs reject manipulated totals, duplicate additions, foreign additions, and limits", async () => {
  const cart = await carts.read(token),
    base = {
      operation: "add",
      ...versionOf(cart),
      productId: String(productId),
      quantity: 1,
      additionIds: [],
    };
  for (const extra of [
    { totalToman: 1 },
    { quantity: 101 },
    { quantity: 0 },
    { additionIds: [String(additionId), String(additionId)] },
    { customerId: "forged" },
  ])
    expect(() => carts.mutate(token, { ...base, ...extra })).toThrow();
  const unavailable = await carts.mutate(token, {
    ...base,
    additionIds: [String(new mongoose.Types.ObjectId())],
  });
  expect(unavailable.accepted).toBe(false);
  expect(unavailable.items).toEqual([]);
  expect(unavailable.issues[0].code).toBe("ADDITION_UNAVAILABLE");
  const full = await add(unavailable, 100, []);
  await expect(add(full, 1, [])).rejects.toMatchObject({ code: "VALIDATION" });
});
test("checkout previews reread changed base/addition prices and stabilize snapshots", async () => {
  let cart = await add(await carts.read(token));
  await connection
    .db!.collection("products")
    .updateOne({ _id: productId }, { $set: { basePriceToman: 120000 } });
  await connection
    .db!.collection("product_additions")
    .updateOne({ _id: additionId }, { $set: { priceToman: 20000 } });
  cart = await carts.preview(token, versionOf(cart));
  expect(cart.pricing.totalToman).toBe(280000);
  expect(cart.issues).toContainEqual({
    code: "PRICE_CHANGED",
    itemKey: String(productId) + ":" + additionId,
    previousUnitPriceToman: 110000,
    currentUnitPriceToman: 140000,
  });
  expect(cart.checkoutReady).toBe(false);
  cart = await carts.preview(token, versionOf(cart));
  expect(cart.issues).toEqual([]);
  expect(cart.checkoutReady).toBe(true);
});
test("mutations refresh all existing prices, including notes changes", async () => {
  const cart = await add(await carts.read(token));
  await connection
    .db!.collection("products")
    .updateOne({ _id: productId }, { $set: { basePriceToman: 200000 } });
  const result = await carts.mutate(token, {
    operation: "notes",
    ...versionOf(cart),
    notes: "لطفا گرم",
  });
  expect(result.pricing.totalToman).toBe(420000);
  expect(result.issues[0].code).toBe("PRICE_CHANGED");
  const added = await add(result, 1);
  expect(added.items[0].quantity).toBe(3);
  expect(added.pricing.totalToman).toBe(630000);
});
test("shared stock is aggregated across distinct selections, never reserved by cart writes", async () => {
  const itemId = new mongoose.Types.ObjectId();
  await connection
    .db!.collection("inventory_items")
    .insertOne({ _id: itemId, unit: "gram", status: "active", onHand: 250 });
  await connection
    .db!.collection("product_consumption_rules")
    .insertOne({ productId, inventoryItemId: itemId, quantityPerUnit: 100, active: true });
  let cart = await add(await carts.read(token), 2);
  expect(cart.checkoutReady).toBe(true);
  cart = await add(cart, 1, []);
  expect(cart.checkoutReady).toBe(false);
  expect(cart.issues.filter((i) => i.code === "INSUFFICIENT_STOCK")).toHaveLength(2);
  expect(
    (await connection.db!.collection("inventory_items").findOne({ _id: itemId }))!.onHand,
  ).toBe(250);
  await connection
    .db!.collection("inventory_items")
    .updateOne({ _id: itemId }, { $set: { onHand: 0 } });
  cart = await carts.preview(token, versionOf(cart));
  expect(cart.issues.some((i) => i.code === "PRODUCT_UNAVAILABLE")).toBe(true);
});
test("updating into an existing selection merges atomically and missing keys fail", async () => {
  let cart = await add(await carts.read(token), 2);
  cart = await add(cart, 1, []);
  cart = await carts.mutate(token, {
    operation: "update",
    ...versionOf(cart),
    itemKey: String(productId) + ":" + additionId,
    quantity: 4,
    additionIds: [],
  });
  expect(cart.items).toHaveLength(1);
  expect(cart.items[0].quantity).toBe(5);
  await expect(
    carts.mutate(token, {
      operation: "remove",
      ...versionOf(cart),
      itemKey: String(new mongoose.Types.ObjectId()),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
test("oversized carts fail before any catalog calls and legacy duplicates require review", async () => {
  let cart = await add(await carts.read(token), 1, []);
  const row = await connection
    .db!.collection("carts")
    .findOne({ _id: new mongoose.Types.ObjectId(cart.id) });
  const migration = await import("@/server/database/migrations/0009-cart-workflows");
  await connection
    .db!.collection("carts")
    .updateOne({ _id: row!._id }, { $set: { items: [row!.items[0], row!.items[0]] } });
  await expect(
    connection.transaction((session) => migration.up(connection.db!, session, time)),
  ).rejects.toThrow("operator review");
  const many = Array.from({ length: 50 }, () => ({
    ...row!.items[0],
    productId: new mongoose.Types.ObjectId(),
  }));
  await connection.db!.collection("carts").updateOne({ _id: row!._id }, { $set: { items: many } });
  await expect(add(cart, 1, [])).rejects.toMatchObject({ code: "VALIDATION" });
  await connection
    .db!.collection("carts")
    .updateOne({ _id: row!._id }, { $set: { items: row!.items } });
  cart = await carts.read(token);
  expect(cart.items).toHaveLength(1);
});
test.each(["draft", "archived", "inactive", "deleted", "category"])(
  "unavailable %s products cannot enter or checkout a cart",
  async (state) => {
    const cart = await add(await carts.read(token));
    if (state === "category")
      await connection
        .db!.collection("categories")
        .updateOne({ _id: categoryId }, { $set: { status: "draft" } });
    else
      await connection.db!.collection("products").updateOne(
        { _id: productId },
        {
          $set:
            state === "inactive"
              ? { available: false }
              : state === "deleted"
                ? { deletedAt: time }
                : { status: state },
        },
      );
    const preview = await carts.preview(token, versionOf(cart));
    expect(preview.issues[0].code).toBe("PRODUCT_UNAVAILABLE");
    expect(preview.checkoutReady).toBe(false);
    const attempted = await add(preview);
    expect(attempted.accepted).toBe(false);
    expect(attempted.items[0].quantity).toBe(2);
  },
);
test("inactive and deleted additions are reported without silently removing choices", async () => {
  let cart = await add(await carts.read(token));
  await connection
    .db!.collection("product_additions")
    .updateOne({ _id: additionId }, { $set: { available: false } });
  cart = await carts.preview(token, versionOf(cart));
  expect(cart.issues[0].code).toBe("ADDITION_UNAVAILABLE");
  expect(cart.items[0].additions).toHaveLength(1);
  await connection.db!.collection("product_additions").deleteOne({ _id: additionId });
  cart = await carts.preview(token, versionOf(cart));
  expect(cart.checkoutReady).toBe(false);
  expect(cart.issues[0].code).toBe("ADDITION_UNAVAILABLE");
});
test("concurrent first reads and mutations are isolated and version protected", async () => {
  const [first, second] = await Promise.all([carts.read(token), carts.read(secondToken)]);
  expect(first.id).toBe(second.id);
  const results = await Promise.allSettled([
    add(first, 1),
    carts.mutate(secondToken, { operation: "notes", ...versionOf(second), notes: "همزمان" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  expect(await connection.db!.collection("carts").countDocuments({ status: "active" })).toBe(1);
  const other = await carts.read(otherToken);
  expect(other.id).not.toBe(first.id);
  await expect(carts.preview(otherToken, versionOf(first))).rejects.toMatchObject({
    code: "CONFLICT",
  });
});
test("logical expiry and TTL-deleted carts reject stale writes without resurrection", async () => {
  const cart = await add(await carts.read(token));
  time = new Date(time.getTime() + 24 * 60 * 60 * 1000);
  const result = await carts.preview(token, versionOf(cart));
  expect(result.issues).toEqual([{ code: "CART_EXPIRED" }]);
  expect(result.accepted).toBe(false);
  const fresh = await carts.read(token);
  expect(fresh.id).not.toBe(cart.id);
  expect(fresh.items).toEqual([]);
  await expect(add(cart)).rejects.toMatchObject({ code: "CONFLICT" });
  await connection.db!.collection("carts").deleteMany({});
  expect((await add(fresh)).issues).toEqual([{ code: "CART_EXPIRED" }]);
  expect(await connection.db!.collection("carts").countDocuments({})).toBe(0);
});
test("every material mutation calls a single bounded batch pricing port", async () => {
  const catalog = vi.fn((ids: string[], tx: object) =>
    productPricingProjection(connection, ids, tx as mongoose.ClientSession),
  );
  const service = createCartService(
    connection,
    { authorize: (t, tx) => security.store.authorize(t, tx), catalog },
    clock,
  );
  let cart = await service.read(token);
  catalog.mockClear();
  cart = await service.mutate(token, {
    operation: "add",
    ...versionOf(cart),
    productId: String(productId),
    quantity: 1,
    additionIds: [],
  });
  expect(catalog).toHaveBeenCalledTimes(1);
  expect(catalog.mock.calls[0][0]).toEqual([String(productId)]);
  catalog.mockClear();
  await service.mutate(token, { operation: "notes", ...versionOf(cart), notes: "سلام" });
  expect(catalog).toHaveBeenCalledTimes(1);
});
test("cart HTTP enforces origin and customer authentication and rejects revoked tokens", async () => {
  const handler = createCartHttpHandler({
    service: async () => carts,
    token: () => token,
    origins: () => ["https://caffe.example"],
  });
  expect(
    (
      await handler(
        new Request("https://caffe.example/api/customer/cart", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
        "mutate",
      )
    ).status,
  ).toBe(403);
  await expect(carts.read("A".repeat(43))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const password = "customer-cart-password-12345";
  const temporary = (
    await security.auth.login({ phone: "09129999999", password }, null, "temporary-login")
  ).token;
  await security.auth.logout(temporary, "logout");
  await expect(carts.read(temporary)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
