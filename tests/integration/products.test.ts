import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { createAdminSecurity } from "@/modules/auth/server";
import { createCategoryService } from "@/modules/catalog/categories/server";
import { parseProductListQuery } from "@/modules/catalog/products";
import { createInventoryService } from "@/modules/inventory/server";
import { MongoMediaRepository } from "@/modules/media/infrastructure/repository";
import { makeOrderItemSnapshot } from "@/modules/orders";
import { composeProductService } from "@/server/catalog/products";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;
let time = new Date("2026-01-01T00:00:00.000Z");
const clock = () => new Date(time);
let category: ReturnType<typeof createCategoryService>;
let products: ReturnType<typeof composeProductService>;
let inventory: ReturnType<typeof createInventoryService>;
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
    .createConnection(replica.getUri(isolatedResources("products").databaseName), {
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
  products = composeProductService(
    connection,
    (token, capability, tx) => security.store.authorize(token, capability, tx),
    clock,
  );
  inventory = createInventoryService(
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
    "product_additions",
    "product_consumption_rules",
    "inventory_items",
    "inventory_movements",
    "stock_approval_requests",
    "orders",
    "invoices",
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

type ProductDto = {
  id: string;
  revision: number;
  status: string;
  slug: string;
  additions: { id: string; name: string; mediaId: string | null; priceToman: number }[];
  consumptionRules: unknown[];
  soldCount: number;
};
async function media() {
  const id = new mongoose.Types.ObjectId();
  await connection.db!.collection("media_assets").insertOne({
    _id: id,
    objectKey: "image-" + id,
    uploaderId: new mongoose.Types.ObjectId(),
    initiationKey: String(id),
    status: "ready",
    visibility: "public",
    deletedAt: null,
    referenceGuard: 0,
  });
  return String(id);
}
async function setup() {
  const cat = await category.create(ownerToken, { name: "قهوه", status: "published" }, "category");
  const image = await media(),
    extraImage = await media();
  const item = await inventory.repository.create(
    ownerToken,
    { name: "دانه", unit: "gram", reorderLevel: 10 },
    "stock",
  );
  const raw = {
    categoryId: cat.id,
    name: "قهوه ۱۲",
    basePriceToman: 100000,
    excerpt: "قهوه تازه",
    ingredients: "دانه قهوه",
    mediaIds: [image],
    additions: [
      { name: "شیر", priceToman: 10000, mediaId: extraImage },
      { name: "خامه", priceToman: 5000, available: false },
    ],
    consumptionRules: [{ inventoryItemId: item.id, quantity: "0.020", unit: "kilogram" }],
  };
  const product = (await products.create(ownerToken, raw, "create")) as ProductDto;
  return { cat, image, extraImage, item, raw, product };
}
test("explicit lifecycle validates publication and keeps stable Persian slug", async () => {
  const { product, raw } = await setup();
  expect(product).toMatchObject({ status: "draft", slug: "قهوه-12" });
  const collision = (await products.create(ownerToken, raw, "collision")) as ProductDto;
  expect(collision.slug).toBe("قهوه-12-2");
  const published = (await products.transition(
    ownerToken,
    product.id,
    { revision: product.revision },
    "published",
    "publish",
  )) as ProductDto;
  expect(published.status).toBe("published");
  await expect(
    products.transition(
      ownerToken,
      product.id,
      { revision: published.revision },
      "published",
      "again",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const draft = (await products.transition(
    ownerToken,
    product.id,
    { revision: published.revision },
    "draft",
    "unpublish",
  )) as ProductDto;
  const archived = (await products.transition(
    ownerToken,
    product.id,
    { revision: draft.revision },
    "archived",
    "archive",
  )) as ProductDto;
  expect(archived.consumptionRules).toEqual([]);
  await expect(
    products.transition(
      ownerToken,
      product.id,
      { revision: archived.revision },
      "published",
      "restore",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    products.update(ownerToken, product.id, { revision: archived.revision, name: "تغییر" }, "edit"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const incomplete = (await products.create(
    ownerToken,
    { categoryId: raw.categoryId, name: "پیش نویس" },
    "incomplete",
  )) as ProductDto;
  await expect(
    products.transition(
      ownerToken,
      incomplete.id,
      { revision: incomplete.revision },
      "published",
      "bad-publish",
    ),
  ).rejects.toMatchObject({ code: "VALIDATION" });
});

test("admin product pages are bounded, filterable and readable by cashier", async () => {
  const { cat } = await setup();
  await connection.db!.collection("products").insertMany(
    Array.from({ length: 21 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      categoryId: new mongoose.Types.ObjectId(cat.id),
      name: `محصول ${index}`,
      slug: `محصول-${index}`,
      description: "",
      excerpt: "",
      ingredients: "",
      basePriceToman: index * 1000,
      mediaIds: [],
      available: index % 2 === 0,
      sortOrder: index,
      status: "draft",
      deletedAt: null,
      createdAt: clock(),
      updatedAt: clock(),
      __v: 0,
    })),
  );
  const first = await products.listPage(
    ownerToken,
    parseProductListQuery({ status: "draft", page: "1" }),
  );
  const second = await products.listPage(
    cashierToken,
    parseProductListQuery({ status: "draft", page: "2" }),
  );
  expect(first.total).toBe(22);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(2);
  const search = await products.listPage(
    cashierToken,
    parseProductListQuery({ q: "قهوه", category: cat.id, available: "yes" }),
  );
  expect(search.items.map((item) => item.name)).toEqual(["قهوه ۱۲"]);
  expect(JSON.stringify(search)).not.toMatch(/ingredients|description|consumptionRules/u);
});

test("owner mutations, cashier reads, and invalid category/media/units fail safely", async () => {
  const { product, cat, image } = await setup();
  await expect(
    products.create(cashierToken, { categoryId: cat.id, name: "نامجاز" }, "cashier"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await products.detail(cashierToken, product.id)).toMatchObject({ id: product.id });
  await expect(
    products.create(
      ownerToken,
      { categoryId: new mongoose.Types.ObjectId().toString(), name: "نامعتبر" },
      "bad-category",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await connection
    .db!.collection("media_assets")
    .updateOne({ _id: new mongoose.Types.ObjectId(image) }, { $set: { visibility: "private" } });
  await expect(
    products.transition(
      ownerToken,
      product.id,
      { revision: product.revision },
      "published",
      "bad-image",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await connection
    .db!.collection("media_assets")
    .updateOne({ _id: new mongoose.Types.ObjectId(image) }, { $set: { visibility: "public" } });
  await category.update(ownerToken, cat.id, { revision: 0, status: "draft" }, "inactive");
  await expect(
    products.transition(
      ownerToken,
      product.id,
      { revision: product.revision },
      "published",
      "inactive",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("additions and rules replace atomically, preserve IDs and reject stale concurrent edits", async () => {
  const { product, item } = await setup();
  const additions = [...product.additions].reverse();
  const invalid = {
    revision: product.revision,
    additions: additions.map((a) => ({
      id: a.id,
      name: a.name,
      priceToman: a.priceToman,
      mediaId: a.mediaId,
      available: true,
    })),
    consumptionRules: [{ inventoryItemId: item.id, quantity: 1, unit: "liter" }],
  };
  const events = await connection.db!.collection("outbox_events").countDocuments({});
  await expect(products.update(ownerToken, product.id, invalid, "bad-unit")).rejects.toMatchObject({
    code: "VALIDATION",
  });
  expect(
    ((await products.detail(ownerToken, product.id)) as ProductDto).additions.map((a) => a.id),
  ).toEqual(product.additions.map((a) => a.id));
  expect(await connection.db!.collection("outbox_events").countDocuments({})).toBe(events);
  const outcomes = await Promise.allSettled([
    products.update(
      ownerToken,
      product.id,
      { ...invalid, consumptionRules: [{ inventoryItemId: item.id, quantity: 30, unit: "gram" }] },
      "race-a",
    ),
    products.update(
      ownerToken,
      product.id,
      {
        revision: product.revision,
        name: "نام تازه",
        consumptionRules: [{ inventoryItemId: item.id, quantity: 40, unit: "gram" }],
      },
      "race-b",
    ),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const current = (await products.detail(ownerToken, product.id)) as ProductDto;
  expect(current.revision).toBe(1);
  const rule = await connection.db!.collection("product_consumption_rules").findOne({});
  if (current.additions[0].id === additions[0].id) expect(rule!.quantityPerUnit).toBe(30);
  else expect(rule!.quantityPerUnit).toBe(40);
});

test("public menu is active-only, stock-aware, ordered and excludes internal fields", async () => {
  const { product, cat, item } = await setup();
  await products.transition(ownerToken, product.id, { revision: 0 }, "published", "publish");
  let menu = await products.menu();
  expect(menu[0].products[0]).toMatchObject({ id: product.id, orderable: false });
  expect(menu[0].products[0].additions).toHaveLength(1);
  const pending = await inventory.repository.request(
    cashierToken,
    {
      inventoryItemId: item.id,
      kind: "purchase",
      quantity: 100,
      unit: "gram",
      reason: "خرید",
      idempotencyKey: "product-purchase",
    },
    "purchase",
  );
  await inventory.repository.decide(ownerToken, pending.id, { decision: "approved" }, "approve");
  menu = await products.menu();
  expect(menu[0].products[0].orderable).toBe(true);
  const serialized = JSON.stringify(menu);
  for (const internal of [
    "consumptionRules",
    "onHand",
    "quantityPerUnit",
    "revision",
    "deletedAt",
    "status",
    "cost",
  ])
    expect(serialized).not.toContain('"' + internal + '"');
  await category.update(ownerToken, cat.id, { revision: 0, status: "draft" }, "hide");
  expect(await products.menu()).toEqual([]);
});

test("legacy oversized addition list fails closed rather than returning an unbounded detail", async () => {
  const { product } = await setup();
  await connection.db!.collection("product_additions").insertMany(
    Array.from({ length: 39 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(product.id),
      name: `Legacy extra ${index}`,
      priceToman: 100,
      available: true,
      sortOrder: index + 2,
    })),
  );
  await expect(products.detail(ownerToken, product.id)).rejects.toMatchObject({ code: "CONFLICT" });
});

test("product edits preserve historical order/invoice snapshots and sold count derives from completed paid orders", async () => {
  const { product, cat } = await setup();
  const snapshot = makeOrderItemSnapshot({
    productId: product.id,
    productName: "قهوه ۱۲",
    categoryName: cat.name,
    basePriceToman: 100000,
    quantity: 2,
    additions: [{ additionId: product.additions[0].id, name: "شیر", priceToman: 10000 }],
  });
  const orderId = new mongoose.Types.ObjectId();
  // API DTOs use strings; persisted snapshot references use BSON ObjectIds.
  const persistedSnapshot = {
    ...snapshot,
    productId: new mongoose.Types.ObjectId(snapshot.productId),
    additions: snapshot.additions.map((a) => ({
      ...a,
      additionId: new mongoose.Types.ObjectId(a.additionId),
    })),
  };
  await connection.db!.collection("orders").insertOne({
    _id: orderId,
    code: "AC-1000001",
    idempotencyKey: "snapshot-order",
    items: [persistedSnapshot],
    totalToman: 220000,
    status: "COMPLETED",
    paymentStatus: "paid",
    placedAt: time,
  });
  await connection.db!.collection("invoices").insertOne({
    orderId,
    number: "INV-1000001",
    items: [persistedSnapshot],
    totalToman: 220000,
    status: "issued",
  });
  const beforeOrder = await connection.db!.collection("orders").findOne({ _id: orderId }),
    beforeInvoice = await connection.db!.collection("invoices").findOne({ orderId });
  const updated = (await products.update(
    ownerToken,
    product.id,
    { revision: 0, name: "قهوه تازه", basePriceToman: 200000, additions: [] },
    "edit",
  )) as ProductDto;
  expect(updated.soldCount).toBe(2);
  expect(await connection.db!.collection("orders").findOne({ _id: orderId })).toEqual(beforeOrder);
  expect(await connection.db!.collection("invoices").findOne({ orderId })).toEqual(beforeInvoice);
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "catalog.products.changed" }),
  ).toBe(2);
});

test("addition image references block deletion and release only through product updates", async () => {
  const { product, extraImage } = await setup();
  const mediaRepo = new MongoMediaRepository(
    connection,
    "test-media",
    "a".repeat(64),
    { usages: async () => [], replace: async () => {}, productMediaIds: async () => [] },
    clock,
  );
  await expect(
    mediaRepo.delete(
      { id: new mongoose.Types.ObjectId().toString(), role: "OWNER" },
      extraImage,
      "delete-addition",
      "f".repeat(64),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await connection.db!.collection("media_references").countDocuments({
      field: "additionMediaIds",
      entityId: new mongoose.Types.ObjectId(product.id),
    }),
  ).toBe(1);
  await products.update(ownerToken, product.id, { revision: 0, additions: [] }, "remove");
  expect(
    await connection.db!.collection("media_references").countDocuments({
      field: "additionMediaIds",
      entityId: new mongoose.Types.ObjectId(product.id),
    }),
  ).toBe(0);
});

test("migration 8 backfills safe presentation data and refuses incomplete published products", async () => {
  const { product } = await setup();
  await connection.db!.collection<{ _id: number }>("_schema_migrations").deleteOne({ _id: 8 });
  await connection.db!.collection("products").updateOne(
    { _id: new mongoose.Types.ObjectId(product.id) },
    {
      $unset: { excerpt: "", ingredients: "" },
      $set: { description: "شرح قدیمی", status: "published" },
    },
  );
  expect(await applyMigrations(connection, clock)).toEqual([8]);
  expect(await products.detail(ownerToken, product.id)).toMatchObject({
    excerpt: "شرح قدیمی",
    ingredients: "",
  });
  await connection.db!.collection<{ _id: number }>("_schema_migrations").deleteOne({ _id: 8 });
  await connection
    .db!.collection("products")
    .updateOne({ _id: new mongoose.Types.ObjectId(product.id) }, { $set: { excerpt: "" } });
  await expect(applyMigrations(connection, clock)).rejects.toThrow(/operator review/);
  await connection
    .db!.collection("products")
    .updateOne({ _id: new mongoose.Types.ObjectId(product.id) }, { $set: { excerpt: "شرح" } });
  expect(await applyMigrations(connection, clock)).toEqual([8]);
});

test("category deletion races safely with product creation", async () => {
  const cat = await category.create(ownerToken, { name: "همزمان", status: "published" }, "cat");
  const outcomes = await Promise.allSettled([
    products.create(ownerToken, { categoryId: cat.id, name: "محصول" }, "create"),
    category.delete(ownerToken, cat.id, { revision: 0 }, "delete"),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const count = await connection.db!.collection("products").countDocuments({});
  expect((await category.publicList()).length).toBe(count ? 1 : 0);
});
