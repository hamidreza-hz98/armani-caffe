import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { createAdminSecurity } from "@/modules/auth/server";
import { createInventoryService, inventoryMovementSchema } from "@/modules/inventory/server";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;
let time = new Date("2026-01-01T00:00:00.000Z");
const clock = () => new Date(time);
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
    .createConnection(replica.getUri(isolatedResources("inventory").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  await applyMigrations(connection, clock);
  const security = createAdminSecurity(
    connection,
    "inventory-admin-secret-longer-than-32-chars",
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
  inventory = createInventoryService(
    connection,
    (token, capability, tx) => security.store.authorize(token, capability, tx),
    clock,
  );
});
beforeEach(async () => {
  time = new Date("2026-01-01T00:00:00.000Z");
  for (const name of [
    "inventory_items",
    "inventory_movements",
    "stock_approval_requests",
    "product_consumption_rules",
    "inventory_order_receipts",
    "audit_events",
    "outbox_events",
  ])
    await connection.db!.collection(name).deleteMany({});
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

const stock = () => inventory.repository;
async function item(name = "دانه قهوه", unit = "gram", reorderLevel = 100) {
  return stock().create(ownerToken, { name, unit, reorderLevel }, "create-item");
}
async function request(
  id: unknown,
  kind: string,
  quantity: string | number,
  key: string,
  token = cashierToken,
  unit = "gram",
) {
  return stock().request(
    token,
    { inventoryItemId: id, kind, quantity, unit, reason: "دلیل تغییر موجودی", idempotencyKey: key },
    key,
  );
}
async function approve(id: unknown) {
  return stock().decide(ownerToken, id, { decision: "approved" }, "approve");
}
async function balance(id: unknown) {
  return (await connection
    .db!.collection("inventory_items")
    .findOne({ _id: new mongoose.Types.ObjectId(String(id)) }))!.onHand;
}

test("cashier requests, owner approves once, and ledger reconciles exactly", async () => {
  const target = await item();
  await expect(
    stock().create(cashierToken, { name: "نامجاز", unit: "gram" }, "denied"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const pending = await request(
    target.id,
    "purchase",
    "1.250",
    "purchase-0001",
    cashierToken,
    "kilogram",
  );
  expect(pending).toMatchObject({ requestedDelta: 1250, unit: "gram", status: "pending" });
  expect(await balance(target.id)).toBe(0);
  await expect(
    stock().decide(cashierToken, pending.id, { decision: "approved" }, "denied"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const results = await Promise.all([approve(pending.id), approve(pending.id)]);
  expect(results[0]).toEqual(results[1]);
  expect(await balance(target.id)).toBe(1250);
  expect(await connection.db!.collection("inventory_movements").countDocuments({})).toBe(1);
  const movement = await connection.db!.collection("inventory_movements").findOne({});
  expect(movement).toMatchObject({ before: 0, after: 1250, delta: 1250, reason: "purchase" });
  expect(
    await connection
      .db!.collection("audit_events")
      .countDocuments({ action: "inventory.approved" }),
  ).toBe(1);
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "inventory.threshold_changed" }),
  ).toBe(1);
  expect(
    await request(target.id, "purchase", "1.250", "purchase-0001", cashierToken, "kilogram"),
  ).toMatchObject({ id: pending.id });
  await expect(
    request(target.id, "purchase", 2, "purchase-0001", cashierToken, "kilogram"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("initial balance, corrections, waste, and rejection preserve invariants", async () => {
  const target = await item();
  await expect(request(target.id, "initial", 500, "initial-0000")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const initial = await request(target.id, "initial", 500, "initial-0001", ownerToken);
  await approve(initial.id);
  await expect(
    request(target.id, "initial", 500, "initial-0002", ownerToken),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const correction = await request(target.id, "adjustment", -100, "correct-0001");
  await approve(correction.id);
  const waste = await request(target.id, "waste", -50, "waste-0001");
  await approve(waste.id);
  expect(await balance(target.id)).toBe(350);
  const rejected = await request(target.id, "purchase", 100, "rejected-0001");
  await stock().decide(ownerToken, rejected.id, { decision: "rejected" }, "reject");
  await stock().decide(ownerToken, rejected.id, { decision: "rejected" }, "reject-retry");
  await expect(approve(rejected.id)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await connection.db!.collection("inventory_movements").countDocuments({})).toBe(3);
  await expect(request(target.id, "waste", 50, "bad-waste-0001")).rejects.toMatchObject({
    code: "VALIDATION",
  });
});

test("concurrent approvals cannot overdraw and failure rolls back decision, ledger and events", async () => {
  const target = await item();
  await approve((await request(target.id, "purchase", 100, "purchase-0001")).id);
  const a = await request(target.id, "waste", -80, "waste-race-a");
  const b = await request(target.id, "waste", -80, "waste-race-b");
  const outcomes = await Promise.allSettled([approve(a.id), approve(b.id)]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await balance(target.id)).toBe(20);
  expect(await connection.db!.collection("inventory_movements").countDocuments({})).toBe(2);
  expect(
    await connection
      .db!.collection("stock_approval_requests")
      .countDocuments({ status: "pending" }),
  ).toBe(1);
  expect(
    await connection
      .db!.collection("audit_events")
      .countDocuments({ action: "inventory.approved" }),
  ).toBe(2);
  const sum = (await connection.db!.collection("inventory_movements").find({}).toArray()).reduce(
    (total, movement) => total + movement.delta,
    0,
  );
  expect(sum).toBe(await balance(target.id));
});

test("threshold events include low, out and recovery, including threshold edits", async () => {
  const target = await item();
  await approve((await request(target.id, "purchase", 200, "purchase-0001")).id);
  await approve((await request(target.id, "waste", -150, "waste-low-0001")).id);
  await approve((await request(target.id, "waste", -50, "waste-out-0001")).id);
  await approve((await request(target.id, "purchase", 50, "purchase-recover")).id);
  const current = await connection
    .db!.collection("inventory_items")
    .findOne({ _id: new mongoose.Types.ObjectId(String(target.id)) });
  await stock().update(
    ownerToken,
    target.id,
    { revision: current!.__v, reorderLevel: 20 },
    "new-threshold",
  );
  const events = await connection
    .db!.collection("outbox_events")
    .find({ eventType: "inventory.threshold_changed" })
    .sort({ _id: 1 })
    .toArray();
  expect(events.map((e) => e.payload.current)).toEqual([
    "available",
    "low",
    "out",
    "low",
    "available",
  ]);
});

test("reversal uses original delta once; inconsistent and insufficient reversals fail", async () => {
  const target = await item();
  await approve((await request(target.id, "purchase", 200, "purchase-0001")).id);
  const purchase = await connection
    .db!.collection("inventory_movements")
    .findOne({ reason: "purchase" });
  await approve((await request(target.id, "waste", -50, "waste-0001")).id);
  const waste = await connection.db!.collection("inventory_movements").findOne({ reason: "waste" });
  const raw = {
    inventoryItemId: target.id,
    kind: "reversal",
    reversalOf: waste!._id.toString(),
    reason: "برگشت ضایعات",
    idempotencyKey: "reverse-waste-0001",
  };
  await expect(stock().request(cashierToken, raw, "denied")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const a = await stock().request(ownerToken, raw, "reverse-a");
  const b = await stock().request(
    ownerToken,
    { ...raw, idempotencyKey: "reverse-waste-0002" },
    "reverse-b",
  );
  await approve(a.id);
  await approve(a.id);
  await expect(approve(b.id)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await balance(target.id)).toBe(200);
  await approve((await request(target.id, "waste", -100, "waste-0002")).id);
  const undoPurchase = await stock().request(
    ownerToken,
    { ...raw, reversalOf: purchase!._id.toString(), idempotencyKey: "reverse-purchase" },
    "reverse-purchase",
  );
  await expect(approve(undoPurchase.id)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    stock().request(
      ownerToken,
      { ...raw, quantity: 999, idempotencyKey: "forged-reverse" },
      "forged",
    ),
  ).rejects.toMatchObject({ code: "VALIDATION" });
});

test("order consumption and compatible product rules use caller transaction; retries and rollback are safe", async () => {
  const target = await item();
  await approve((await request(target.id, "purchase", 1000, "purchase-0001")).id);
  const productId = new mongoose.Types.ObjectId().toString();
  await connection.transaction((tx) =>
    stock().replaceConsumptionRules(tx, productId, [
      { inventoryItemId: String(target.id), quantity: "0.020", unit: "kilogram" },
    ]),
  );
  expect(await connection.db!.collection("product_consumption_rules").findOne({})).toMatchObject({
    quantityPerUnit: 20,
  });
  await expect(
    connection.transaction((tx) =>
      stock().replaceConsumptionRules(tx, productId, [
        { inventoryItemId: String(target.id), quantity: 20, unit: "liter" },
      ]),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await connection.db!.collection("product_consumption_rules").countDocuments({})).toBe(1);
  const orderId = new mongoose.Types.ObjectId().toString();
  const quantities = [{ inventoryItemId: String(target.id), quantity: 100, unit: "gram" as const }];
  await connection.transaction((tx) => stock().consumeOrder(tx, orderId, quantities, "order"));
  await connection.transaction((tx) => stock().consumeOrder(tx, orderId, quantities, "retry"));
  expect(await balance(target.id)).toBe(900);
  await expect(
    connection.transaction((tx) =>
      stock().consumeOrder(tx, orderId, [{ ...quantities[0], quantity: 101 }], "mismatch"),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const second = await item("شیر", "milliliter", 0);
  const failedOrder = new mongoose.Types.ObjectId().toString();
  await expect(
    connection.transaction((tx) =>
      stock().consumeOrder(
        tx,
        failedOrder,
        [...quantities, { inventoryItemId: String(second.id), quantity: 1, unit: "milliliter" }],
        "failed",
      ),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await balance(target.id)).toBe(900);
  expect(
    await connection
      .db!.collection<{ _id: string }>("inventory_order_receipts")
      .findOne({ _id: failedOrder }),
  ).toBeNull();
  expect(
    await connection.db!.collection("inventory_movements").countDocuments({ reason: "sale" }),
  ).toBe(1);
});

test("archive is terminal and refuses stock, pending requests or active consumption rules", async () => {
  const target = await item();
  const pending = await request(target.id, "purchase", 10, "archive-pending");
  let current = await connection
    .db!.collection("inventory_items")
    .findOne({ _id: new mongoose.Types.ObjectId(String(target.id)) });
  await expect(
    stock().update(
      ownerToken,
      target.id,
      { revision: current!.__v, status: "archived" },
      "archive",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await stock().decide(ownerToken, pending.id, { decision: "rejected" }, "reject");
  await connection.transaction((tx) =>
    stock().replaceConsumptionRules(tx, new mongoose.Types.ObjectId().toString(), [
      { inventoryItemId: String(target.id), quantity: 1, unit: "gram" },
    ]),
  );
  current = await connection
    .db!.collection("inventory_items")
    .findOne({ _id: new mongoose.Types.ObjectId(String(target.id)) });
  await expect(
    stock().update(
      ownerToken,
      target.id,
      { revision: current!.__v, status: "archived" },
      "archive-rules",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await connection.db!.collection("product_consumption_rules").deleteMany({});
  const archived = await stock().update(
    ownerToken,
    target.id,
    { revision: current!.__v, status: "archived" },
    "archive",
  );
  await expect(
    stock().update(
      ownerToken,
      target.id,
      { revision: archived.revision, status: "active" },
      "restore",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(request(target.id, "purchase", 10, "archived-request")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("inventory migration refuses legacy balances and writes fail closed without rollout", async () => {
  const target = await item();
  await connection.db!.collection<{ _id: number }>("_schema_migrations").deleteOne({ _id: 7 });
  await connection
    .db!.collection("inventory_items")
    .updateOne({ _id: new mongoose.Types.ObjectId(String(target.id)) }, { $set: { onHand: 100 } });
  await expect(applyMigrations(connection, clock)).rejects.toThrow(/balance does not match ledger/);
  await expect(request(target.id, "purchase", 10, "missing-rollout")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await connection
    .db!.collection("inventory_items")
    .updateOne({ _id: new mongoose.Types.ObjectId(String(target.id)) }, { $set: { onHand: 0 } });
  expect(await applyMigrations(connection, clock)).toEqual([7]);
});

test("ledger model refuses update and deletion, and stock cannot be edited directly", async () => {
  const Model = connection.model("InventoryImmutabilityTest", inventoryMovementSchema);
  await expect(Model.updateOne({}, { $set: { delta: 1 } })).rejects.toThrow(/append-only/);
  await expect(Model.deleteOne({})).rejects.toThrow(/append-only/);
  const target = await item();
  await expect(
    stock().update(ownerToken, target.id, { revision: 0, onHand: 100 }, "bypass"),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    stock().request(
      ownerToken,
      {
        inventoryItemId: target.id,
        kind: "purchase",
        quantity: 1,
        unit: "ounce",
        reason: "نامعتبر",
        idempotencyKey: "arbitrary-unit",
      },
      "bad-unit",
    ),
  ).rejects.toMatchObject({ code: "VALIDATION" });
});
