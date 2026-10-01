import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { createAdminSecurity, createCustomerSecurity } from "@/modules/auth/server";
import { createInventoryService } from "@/modules/inventory/server";
import { OutboxWorker } from "@/modules/notifications/server";
import { MongoFakeLedger } from "@/modules/payments/server";
import { MongoPrintJobs } from "@/modules/printing/server";
import { settingsDefaults } from "@/modules/settings";
import {
  createSettingsRepository,
  SettingsService,
  SettingsVault,
} from "@/modules/settings/server";
import { composeCartService } from "@/server/commerce/carts";
import { composeInvoiceRepository } from "@/server/commerce/invoices";
import { createOrderHttpHandler } from "@/server/commerce/order-http";
import { composeOrderService } from "@/server/commerce/orders";
import { readCustomerPaymentResult } from "@/server/commerce/payment-results";
import { composePaymentFramework } from "@/server/commerce/payments";
import { printOutboxHandlers } from "@/server/commerce/print-outbox";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";
import type { PrintSchedule } from "@/server/queue";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";
let replica: MongoMemoryReplSet, connection: mongoose.Connection;
const time = new Date("2026-01-01T00:00:00Z"),
  clock = () => new Date(time),
  secret = "order-tests-session-secret-at-least-32",
  key = "1".repeat(64),
  origin = "https://caffe.example";
let orders: ReturnType<typeof composeOrderService>,
  payments: ReturnType<typeof composePaymentFramework>,
  carts: ReturnType<typeof composeCartService>,
  inventory: ReturnType<typeof createInventoryService>,
  ledger: MongoFakeLedger;
let token: string, otherToken: string, ownerToken: string, cashierToken: string, ownerId: string;
const productId = new mongoose.Types.ObjectId(),
  additionId = new mongoose.Types.ObjectId(),
  categoryId = new mongoose.Types.ObjectId();
let stockId: string;
const db = () => connection.db!;
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
    .createConnection(replica.getUri(isolatedResources("orders").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  await applyMigrations(connection, clock);
  const customer = createCustomerSecurity(connection, secret, clock),
    admin = createAdminSecurity(connection, secret + "-admin-isolated", clock);
  const password = "customer-order-password-12345";
  for (const phone of ["09123456789", "09129999999"])
    await customer.auth.signup({ phone, password }, "signup");
  token = (await customer.auth.login({ phone: "09123456789", password }, null, "login")).token;
  otherToken = (await customer.auth.login({ phone: "09129999999", password }, null, "other-login"))
    .token;
  const adminPassword = "owner-order-password-12345";
  await admin.repository.bootstrap(
    {
      username: "owner",
      displayName: "مالک",
      phone: "09121111111",
      password: adminPassword,
      role: "OWNER",
    },
    await admin.passwords.hash(adminPassword),
    "bootstrap",
  );
  ownerToken = (
    await admin.auth.login({ username: "owner", password: adminPassword }, null, "network", "login")
  ).token;
  ownerId = (await admin.auth.resolve(ownerToken))!.id;
  await admin.admins.create(
    ownerToken,
    {
      username: "cashier",
      displayName: "صندوق",
      phone: "09122222222",
      password: adminPassword,
      role: "CASHIER",
    },
    "create-cashier",
  );
  cashierToken = (
    await admin.auth.login(
      { username: "cashier", password: adminPassword },
      null,
      "network",
      "login-cashier",
    )
  ).token;
  inventory = createInventoryService(
    connection,
    (t, c, tx) => admin.store.authorize(t, c, tx),
    clock,
  );
  carts = composeCartService(connection, secret, clock);
});
beforeEach(async () => {
  await db()
    .collection("customers")
    .updateMany({}, { $set: { displayName: null } });
  for (const collection of [
    "orders",
    "invoices",
    "invoice_reprints",
    "print_jobs",
    "checkout_intents",
    "order_counters",
    "order_sales_projection",
    "carts",
    "transactions",
    "fake_payment_ledger",
    "inventory_items",
    "inventory_movements",
    "inventory_order_receipts",
    "stock_approval_requests",
    "product_consumption_rules",
    "categories",
    "products",
    "product_additions",
    "settings",
    "settings_receipts",
    "audit_events",
    "outbox_events",
  ])
    await db().collection(collection).deleteMany({});
  const created = (await inventory.service.create(
    ownerToken,
    { name: "قهوه", unit: "gram", reorderLevel: 200 },
    "stock-create",
  )) as { id: string };
  stockId = created.id;
  await replenish(1000, "initial-0001", "initial");
  await db()
    .collection("categories")
    .insertOne({ _id: categoryId, name: "قهوه", status: "published", deletedAt: null });
  await db().collection("products").insertOne({
    _id: productId,
    categoryId,
    name: "لاته",
    basePriceToman: 100000,
    status: "published",
    available: true,
    deletedAt: null,
  });
  await db()
    .collection("product_additions")
    .insertOne({ _id: additionId, productId, name: "شیر", priceToman: 10000, available: true });
  await connection.transaction((session) =>
    inventory.repository.replaceConsumptionRules(session, String(productId), [
      { inventoryItemId: stockId, quantity: 100, unit: "gram" },
    ]),
  );
  const settings = new SettingsService(
    createSettingsRepository(connection, new SettingsVault(key, undefined, clock), clock),
  );
  await settings.update(
    { id: ownerId, role: "OWNER" },
    "payment",
    "enable-fake",
    {
      revision: 0,
      values: { ...settingsDefaults("payment"), fakeEnabled: true, defaultProvider: "fake" },
    },
    "settings",
  );
  orders = composeOrderService(
    connection,
    { customerSessionSecret: secret, adminSessionSecret: secret + "-admin-isolated" },
    clock,
  );
  payments = composePaymentFramework(connection, {
    vault: new SettingsVault(key, undefined, clock),
    callbackBaseUrl: origin,
    now: clock,
    intent: (id, tx) => orders.repository.paymentIntent(id, tx),
    settled: async (tx, view, requestId) => {
      await orders.repository.confirmInside(tx, view.id, requestId);
    },
  });
  ledger = new MongoFakeLedger(connection);
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  if (replica) await replica.stop();
});
async function replenish(quantity: number, idempotencyKey: string, kind = "purchase") {
  const pending = (await inventory.service.request(
    ownerToken,
    {
      inventoryItemId: stockId,
      kind,
      quantity,
      unit: "gram",
      reason: "تأمین موجودی",
      idempotencyKey,
    },
    "stock-request",
  )) as { id: string };
  await inventory.service.decide(ownerToken, pending.id, { decision: "approved" }, "stock-approve");
}
async function checkout(sessionToken = token, quantity = 2, pickupNotes?: string) {
  const empty = await carts.read(sessionToken);
  let cart = await carts.mutate(sessionToken, {
    operation: "add",
    cartId: empty.id,
    revision: empty.revision,
    productId: String(productId),
    quantity,
    additionIds: [String(additionId)],
  });
  if (pickupNotes)
    cart = await carts.mutate(sessionToken, {
      operation: "notes",
      cartId: cart.id,
      revision: cart.revision,
      notes: pickupNotes,
    });
  const command = {
    cartId: cart.id,
    revision: cart.revision,
    idempotencyKey: "checkout-" + cart.id,
  };
  const intent = await orders.service.checkout(sessionToken, command, "checkout");
  const payment = await payments.create(intent.id, "payment-" + intent.id, "payment");
  return { intent, payment, command, cart };
}
test("pickup request and order note survive paid checkout and immutable invoice", async () => {
  const notes = "تحویل حضوری: حدود ۳۰ دقیقه پس از ثبت سفارش\nتوضیحات سفارش: کمی دیر می‌رسم";
  const { intent, payment } = await checkout(token, 1, notes);
  await settle(payment);
  await orders.service.confirm(payment.id, "confirm-pickup-note");
  expect((await orders.service.detail(token, intent.id, true)).notes).toBe(notes);
  expect(
    await db()
      .collection("invoices")
      .findOne({ orderId: new mongoose.Types.ObjectId(intent.id) }),
  ).toMatchObject({ notes });
});
async function settle(view: Awaited<ReturnType<typeof checkout>>["payment"]) {
  await ledger.outcome(view.authority!, {
    kind: "succeeded",
    authority: view.authority!,
    reference: "reference-" + view.id,
    amountToman: view.amountToman,
    currency: "TOMAN",
  });
  return payments.inquire(view.id, "verify");
}
async function balance() {
  return (await db()
    .collection("inventory_items")
    .findOne({ _id: new mongoose.Types.ObjectId(stockId) }))!.onHand;
}
test("verified payment atomically creates one coded order, closes cart, deducts ledger, increments sold count and outbox", async () => {
  const { intent, payment, command } = await checkout();
  expect(await orders.service.checkout(token, command, "replay")).toMatchObject({ id: intent.id });
  await expect(orders.service.confirm(payment.id, "unpaid")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await db().collection("orders").countDocuments({})).toBe(0);
  const verified = await settle(payment);
  expect(verified.status).toBe("succeeded");
  const callbacks = Array.from({ length: 12 }, () => {
    const url = new URL(payment.redirectUrl!);
    return payments.callback(
      payment.id,
      "fake",
      "GET",
      url,
      Object.fromEntries(url.searchParams),
      "duplicate",
    );
  });
  await Promise.all([
    ...callbacks,
    ...Array.from({ length: 12 }, () => orders.service.confirm(payment.id, "retry")),
  ]);
  const row = await orders.service.detail(token, intent.id, true);
  expect(row).toMatchObject({
    code: "AC-0000001",
    status: "NEW",
    paymentStatus: "paid",
    pricing: { totalToman: 220000 },
    transaction: { id: payment.id },
    customer: { phone: "+989123456789" },
  });
  expect(await balance()).toBe(800);
  expect(await db().collection("orders").countDocuments({})).toBe(1);
  expect(await db().collection("invoices").countDocuments({})).toBe(1);
  expect(
    await db().collection("outbox_events").countDocuments({ eventType: "invoice.issued" }),
  ).toBe(1);
  expect(await db().collection("inventory_movements").countDocuments({ reason: "sale" })).toBe(1);
  expect(await db().collection("order_sales_projection").findOne({ _id: productId })).toMatchObject(
    { count: 2 },
  );
  expect(
    await db()
      .collection("carts")
      .findOne({ _id: new mongoose.Types.ObjectId(command.cartId) }),
  ).toMatchObject({ status: "checked_out", items: [], totalToman: 0 });
  expect(
    await db().collection("outbox_events").countDocuments({ eventType: "order.confirmed" }),
  ).toBe(1);
  expect(await db().collection("audit_events").countDocuments({ action: "order.confirmed" })).toBe(
    1,
  );
  expect(JSON.stringify(await db().collection("audit_events").find({}).toArray())).not.toContain(
    "09123456789",
  );
});
test("invoice freezes settings and order snapshots and event replay returns the same document", async () => {
  const settings = new SettingsService(
    createSettingsRepository(connection, new SettingsVault(key, undefined, clock), clock),
  );
  await settings.update(
    { id: ownerId, role: "OWNER" },
    "business",
    "invoice-business",
    { revision: 0, values: { ...settingsDefaults("business"), title: "کافه آرمانی" } },
    "settings",
  );
  await settings.update(
    { id: ownerId, role: "OWNER" },
    "printing",
    "invoice-printing",
    {
      revision: 0,
      values: { ...settingsDefaults("printing"), paperWidthMm: 58, footer: "سپاس از شما" },
    },
    "settings",
  );
  const { intent, payment } = await checkout();
  await settle(payment);
  const invoices = composeInvoiceRepository(
    connection,
    { customerSessionSecret: secret, adminSessionSecret: secret + "-admin-isolated" },
    clock,
  );
  const original = await invoices.read(token, intent.id, true);
  expect(original).toMatchObject({
    number: "INV-AC-0000001",
    identity: { title: "کافه آرمانی", footer: "سپاس از شما" },
    paperWidthMm: 58,
    customer: { phone: "+989123456789" },
    transaction: { reference: "reference-" + payment.id },
  });
  expect(original.lines[0]).toMatchObject({
    productName: "لاته",
    quantity: 2,
    additions: [{ name: "شیر", priceToman: 10000 }],
  });
  await db()
    .collection("products")
    .updateOne({ _id: productId }, { $set: { name: "بعداً تغییر یافت", basePriceToman: 1 } });
  await settings.update(
    { id: ownerId, role: "OWNER" },
    "business",
    "invoice-business-edit",
    { revision: 1, values: { ...settingsDefaults("business"), title: "نام تازه" } },
    "settings",
  );
  await orders.service.confirm(payment.id, "replayed");
  expect(await invoices.onOrderConfirmed(intent.id)).toEqual(original);
  expect(await invoices.read(ownerToken, intent.id, false)).toEqual(original);
  await expect(invoices.read(otherToken, intent.id, true)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db().collection("invoices").countDocuments({})).toBe(1);
});
test("owner and cashier reprints are audited exactly once per key without replacing invoice", async () => {
  const { intent, payment } = await checkout();
  await settle(payment);
  const invoices = composeInvoiceRepository(
    connection,
    { customerSessionSecret: secret, adminSessionSecret: secret + "-admin-isolated" },
    clock,
  );
  const first = await invoices.reprint(
    ownerToken,
    intent.id,
    { idempotencyKey: "receipt-key-001", paperWidthMm: 58 },
    "owner-reprint",
  );
  expect(
    await invoices.reprint(
      ownerToken,
      intent.id,
      { idempotencyKey: "receipt-key-001", paperWidthMm: 58 },
      "owner-retry",
    ),
  ).toEqual(first);
  await expect(
    invoices.reprint(
      ownerToken,
      intent.id,
      { idempotencyKey: "receipt-key-001", paperWidthMm: 80 },
      "conflict",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await invoices.reprint(
    cashierToken,
    intent.id,
    { idempotencyKey: "cashier-key-001" },
    "cashier-reprint",
  );
  await expect(
    invoices.reprint(token, intent.id, { idempotencyKey: "customer-key-001" }, "denied"),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db().collection("invoices").countDocuments({})).toBe(1);
  expect(await db().collection("invoice_reprints").countDocuments({})).toBe(2);
  expect(
    await db().collection("audit_events").countDocuments({ action: "invoice.reprint_requested" }),
  ).toBe(2);
  expect(
    await db()
      .collection("outbox_events")
      .countDocuments({ eventType: "invoice.reprint_requested" }),
  ).toBe(2);
});
test("paid order outbox makes one active automatic print job and audited reprint makes a second linked job", async () => {
  const settings = new SettingsService(
    createSettingsRepository(connection, new SettingsVault(key, undefined, clock), clock),
  );
  await settings.update(
    { id: ownerId, role: "OWNER" },
    "printing",
    "enable-auto-print",
    {
      revision: 0,
      values: {
        ...settingsDefaults("printing"),
        enabled: true,
        automaticPrint: true,
        bridgeId: "test-bridge",
      },
      secrets: { bridgeToken: "test_printer_bridge_token_32_characters" },
    },
    "settings",
  );
  const { intent, payment } = await checkout();
  await settle(payment);
  const invoice = await composeInvoiceRepository(
    connection,
    { customerSessionSecret: secret, adminSessionSecret: secret + "-admin-isolated" },
    clock,
  ).read(ownerToken, intent.id, false);
  expect(invoice.printing).toEqual({ automatic: true, printerId: "test-bridge" });
  const due = new Map<string, number>();
  const schedule: PrintSchedule = {
    schedule: async (id, at) => {
      due.set(id, at.getTime());
    },
    due: async () => [...due.keys()],
    remove: async (id) => {
      due.delete(id);
    },
    acquirePresence: async () => true,
    refreshPresence: async () => true,
    releasePresence: async () => {},
    ping: async () => {},
    close: async () => {},
  };
  const worker = new OutboxWorker(
    connection,
    printOutboxHandlers(connection, schedule, "test-bridge", clock),
    { workerId: "invoice-print-test", now: clock },
  );
  expect(await worker.runOnce()).toBe(true);
  expect(await worker.runOnce()).toBe(false);
  const repository = new MongoPrintJobs(connection, clock);
  expect(await repository.byOrder(intent.id)).toMatchObject([
    { invoiceId: invoice.id, source: "automatic", status: "queued", printerId: "test-bridge" },
  ]);
  expect(due.size).toBe(1);
  await composeInvoiceRepository(
    connection,
    { customerSessionSecret: secret, adminSessionSecret: secret + "-admin-isolated" },
    clock,
  ).reprint(
    ownerToken,
    intent.id,
    { idempotencyKey: "print-replay-001", paperWidthMm: 80 },
    "manual-reprint",
  );
  expect(await worker.runOnce()).toBe(true);
  expect(await repository.byOrder(intent.id)).toMatchObject([
    { source: "automatic" },
    { source: "reprint", paperWidthMm: 80 },
  ]);
  expect(await db().collection("invoices").countDocuments({})).toBe(1);
});
test("frozen customer/catalog/addition/stock snapshots survive later edits and prices cannot be supplied", async () => {
  const { intent, payment } = await checkout();
  await db()
    .collection("products")
    .updateOne({ _id: productId }, { $set: { name: "ویرایش", basePriceToman: 1 } });
  await db()
    .collection("product_additions")
    .updateOne({ _id: additionId }, { $set: { name: "ویرایش", priceToman: 1 } });
  await db()
    .collection("customers")
    .updateOne({ phone: "+989123456789" }, { $set: { displayName: "نام جدید" } });
  await connection.transaction((tx) =>
    inventory.repository.replaceConsumptionRules(tx, String(productId), [
      { inventoryItemId: stockId, quantity: 1, unit: "gram" },
    ]),
  );
  await settle(payment);
  const row = await orders.service.detail(token, intent.id, true);
  expect(row.items[0]).toMatchObject({
    productName: "لاته",
    categoryName: "قهوه",
    unitPriceToman: 110000,
    additions: [{ name: "شیر", priceToman: 10000 }],
  });
  expect(row.customer.displayName).toBeNull();
  expect(await balance()).toBe(800);
  expect(() =>
    orders.service.checkout(
      token,
      { cartId: intent.cartId, revision: 0, idempotencyKey: "evil-12345", totalToman: 1 },
      "evil",
    ),
  ).toThrow();
});
test("paid shortage has no partial writes, retains payment truth and owner recovers exact same quote", async () => {
  const { intent, payment } = await checkout(token, 10);
  const waste = (await inventory.service.request(
    ownerToken,
    {
      inventoryItemId: stockId,
      kind: "waste",
      quantity: -100,
      unit: "gram",
      reason: "ضایعات",
      idempotencyKey: "waste-0001",
    },
    "waste",
  )) as { id: string };
  await inventory.service.decide(ownerToken, waste.id, { decision: "approved" }, "approve");
  expect((await settle(payment)).status).toBe("succeeded");
  const recovery = await orders.service.checkoutView(token, intent.id);
  expect(recovery).toMatchObject({ state: "RECOVERY_REQUIRED", recovery: "INSUFFICIENT_STOCK" });
  expect(await balance()).toBe(900);
  expect(await db().collection("orders").countDocuments({})).toBe(0);
  expect(await db().collection("inventory_movements").countDocuments({ reason: "sale" })).toBe(0);
  expect(await db().collection("order_counters").findOne({})).toBeNull();
  await expect(
    orders.repository.retryRecovery(cashierToken, intent.id, "denied"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await replenish(100, "refill-0001");
  expect(await orders.repository.retryRecovery(ownerToken, intent.id, "recover")).toMatchObject({
    state: "CONFIRMED",
  });
  expect(await balance()).toBe(0);
  expect((await orders.service.detail(token, intent.id, true)).pricing.totalToman).toBe(1100000);
});
test("competing paid checkouts under contention never oversell", async () => {
  const checkouts = await Promise.all([checkout(token, 10), checkout(otherToken, 10)]);
  await Promise.all(checkouts.map((c) => settle(c.payment)));
  expect(await db().collection("orders").countDocuments({})).toBe(1);
  expect(
    await db().collection("checkout_intents").countDocuments({ state: "RECOVERY_REQUIRED" }),
  ).toBe(1);
  expect(await db().collection("transactions").countDocuments({ status: "succeeded" })).toBe(2);
  expect(await balance()).toBe(0);
});
test("late outbox failure rolls back payment status, stock, counter, cart, order and sold projection", async () => {
  const { intent, payment } = await checkout();
  const model = connection.models.OutboxEvent!;
  const original = model.insertMany.bind(model);
  const spy = vi.spyOn(model, "insertMany").mockImplementation((async (
    rows: { eventType: string }[],
    options: object,
  ) => {
    if (rows.some((r) => r.eventType === "order.confirmed"))
      throw new Error("forced outbox outage");
    return original(rows, options);
  }) as typeof model.insertMany);
  try {
    await expect(settle(payment)).rejects.toBeDefined();
  } finally {
    spy.mockRestore();
  }
  expect(await balance()).toBe(1000);
  expect(await db().collection("orders").countDocuments({})).toBe(0);
  expect(await db().collection("inventory_movements").countDocuments({ reason: "sale" })).toBe(0);
  expect(await db().collection("order_sales_projection").countDocuments({})).toBe(0);
  expect(await db().collection("invoices").countDocuments({})).toBe(0);
  expect(await db().collection("audit_events").countDocuments({ action: "invoice.issued" })).toBe(
    0,
  );
  expect(
    await db().collection("outbox_events").countDocuments({ eventType: "invoice.issued" }),
  ).toBe(0);
  expect(
    await db()
      .collection("checkout_intents")
      .findOne({ _id: new mongoose.Types.ObjectId(intent.id) }),
  ).toMatchObject({ state: "PAYMENT_PENDING" });
  expect(
    await db()
      .collection("transactions")
      .findOne({ _id: new mongoose.Types.ObjectId(payment.id) }),
  ).toMatchObject({ status: "pending" });
  // The failed verifier's claim remains leased; an operator/worker retries after lease expiry.
  await db()
    .collection("transactions")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(payment.id) },
      { $set: { lockedUntil: new Date(time.getTime() - 1) } },
    );
  await settle(payment);
  expect(await balance()).toBe(800);
});
test("authorization, strict status machine, version checks, cancellation reversal and refund proof", async () => {
  const { intent, payment } = await checkout();
  await settle(payment);
  await expect(orders.service.detail(otherToken, intent.id, true)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(orders.service.list(ownerToken, true)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(
    orders.service.transition(
      cashierToken,
      intent.id,
      { revision: 0, status: "CANCELLED", reason: "لغو" },
      "denied",
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    orders.service.transition(ownerToken, intent.id, { revision: 0, status: "COMPLETED" }, "skip"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const cancel = await orders.service.transition(
    ownerToken,
    intent.id,
    { revision: 0, status: "CANCELLED", reason: "لغو" },
    "cancel",
  );
  expect(await balance()).toBe(1000);
  expect(cancel.pricing.totalToman).toBe(220000);
  await expect(
    orders.service.transition(
      ownerToken,
      intent.id,
      { revision: 0, status: "CANCELLED", reason: "تکرار" },
      "retry",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db().collection("inventory_movements").countDocuments({ reason: "reversal" })).toBe(
    1,
  );
  expect(await db().collection("order_sales_projection").findOne({ _id: productId })).toMatchObject(
    { count: 0 },
  );
  await orders.service.requestRefund(
    ownerToken,
    intent.id,
    { revision: 1, reason: "لغو مشتری" },
    "refund",
  );
  await expect(
    orders.repository.reconcileRefund(payment.id, "forged-refund"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  // Simulates a trusted adapter recording authoritative provider refund evidence, never browser input.
  await db()
    .collection("transactions")
    .updateOne({ _id: new mongoose.Types.ObjectId(payment.id) }, { $set: { status: "refunded" } });
  await orders.repository.reconcileRefund(payment.id, "verified-refund");
  await orders.repository.reconcileRefund(payment.id, "duplicate-refund");
  expect(await orders.service.detail(token, intent.id, true)).toMatchObject({
    status: "CANCELLED",
    paymentStatus: "refunded",
    refundStatus: "REFUNDED",
  });
});
test("cashier can progress NEW -> PREPARING -> READY -> COMPLETED, completed orders immutable", async () => {
  const { intent, payment } = await checkout();
  await settle(payment);
  for (const [revision, status] of ["PREPARING", "READY", "COMPLETED"].entries())
    await orders.service.transition(cashierToken, intent.id, { revision, status }, "progress");
  await expect(
    orders.service.transition(
      ownerToken,
      intent.id,
      { revision: 3, status: "CANCELLED", reason: "لغو" },
      "denied",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await balance()).toBe(800);
});
test("PREPARING cancellation never silently restocks consumed materials", async () => {
  const { intent, payment } = await checkout();
  await settle(payment);
  await orders.service.transition(
    cashierToken,
    intent.id,
    { revision: 0, status: "PREPARING" },
    "preparing",
  );
  await orders.service.transition(
    ownerToken,
    intent.id,
    { revision: 1, status: "CANCELLED", reason: "لغو پس از آماده‌سازی" },
    "cancel",
  );
  expect(await balance()).toBe(800);
  expect(await db().collection("inventory_movements").countDocuments({ reason: "reversal" })).toBe(
    0,
  );
});
test("paid missing-cart recovery can request a refund, never fulfill while refund is pending", async () => {
  const { intent, payment } = await checkout();
  await db()
    .collection("carts")
    .deleteOne({ _id: new mongoose.Types.ObjectId(intent.cartId) });
  await settle(payment);
  const recovery = await orders.service.checkoutView(token, intent.id);
  expect(recovery).toMatchObject({ state: "RECOVERY_REQUIRED", recovery: "CART_UNAVAILABLE" });
  expect(await orders.repository.recoveries(ownerToken)).toHaveLength(1);
  await expect(
    orders.service.requestRefund(
      cashierToken,
      intent.id,
      { revision: recovery.revision, reason: "لغو" },
      "denied",
      true,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await orders.service.requestRefund(
    ownerToken,
    intent.id,
    { revision: recovery.revision, reason: "بازپرداخت" },
    "refund",
    true,
  );
  expect(await orders.service.confirm(payment.id, "delayed-confirm")).toMatchObject({
    state: "REFUND_REQUESTED",
  });
  expect(await db().collection("orders").countDocuments({})).toBe(0);
  expect(await balance()).toBe(1000);
  await db()
    .collection("transactions")
    .updateOne({ _id: new mongoose.Types.ObjectId(payment.id) }, { $set: { status: "refunded" } });
  await orders.repository.reconcileRefund(payment.id, "verified-refund");
  expect(await orders.service.checkoutView(token, intent.id)).toMatchObject({ state: "REFUNDED" });
});
test("multi-line stock shortage is preflighted without partial deduction or silently changed units", async () => {
  const second = (await inventory.service.create(
    ownerToken,
    { name: "شیر", unit: "milliliter" },
    "milk",
  )) as { id: string };
  const purchase = (await inventory.service.request(
    ownerToken,
    {
      inventoryItemId: second.id,
      kind: "initial",
      quantity: 500,
      unit: "milliliter",
      reason: "موجودی اولیه",
      idempotencyKey: "milk-initial-001",
    },
    "initial",
  )) as { id: string };
  await inventory.service.decide(ownerToken, purchase.id, { decision: "approved" }, "approve");
  await connection.transaction((tx) =>
    inventory.repository.replaceConsumptionRules(tx, String(productId), [
      { inventoryItemId: stockId, quantity: 100, unit: "gram" },
      { inventoryItemId: second.id, quantity: 100, unit: "milliliter" },
    ]),
  );
  const { intent, payment } = await checkout(token, 2);
  // A deliberate test corruption models an incompatible inventory unit introduced externally.
  await db()
    .collection("inventory_items")
    .updateOne({ _id: new mongoose.Types.ObjectId(second.id) }, { $set: { unit: "piece" } });
  await settle(payment);
  expect(await orders.service.checkoutView(token, intent.id)).toMatchObject({
    state: "RECOVERY_REQUIRED",
    recovery: "INSUFFICIENT_STOCK",
  });
  expect(await balance()).toBe(1000);
  expect(await db().collection("inventory_movements").countDocuments({ reason: "sale" })).toBe(0);
});
test("migration preserves old snapshots, seeds human counter and never runs during requests", async () => {
  const migration = await import("@/server/database/migrations/0011-order-confirmation");
  const item = {
    productId,
    productName: "تاریخچه",
    categoryName: "قهوه",
    quantity: 3,
    unitPriceToman: 100,
    lineTotalToman: 300,
    additions: [],
  };
  await db()
    .collection("orders")
    .insertOne({
      code: "AC-0008932",
      status: "completed",
      paymentStatus: "paid",
      idempotencyKey: "legacy-8932",
      items: [item],
      totalToman: 300,
    });
  await connection.transaction((tx) => migration.up(db(), tx));
  expect(await db().collection("orders").findOne({ code: "AC-0008932" })).toMatchObject({
    status: "COMPLETED",
    items: [item],
    totalToman: 300,
  });
  const { intent, payment } = await checkout();
  await settle(payment);
  expect((await orders.service.detail(token, intent.id, true)).code).toBe("AC-0008933");
  await db().collection<{ _id: number }>("_schema_migrations").deleteOne({ _id: 11 });
  await expect(orders.service.list(ownerToken)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await db()
    .collection<{ _id: number; appliedAt: Date }>("_schema_migrations")
    .insertOne({ _id: 11, appliedAt: time });
});
test("HTTP checkout enforces origin, isolated cookies, ownership and never accepts payment totals", async () => {
  const handler = createOrderHttpHandler({
    orders: async () => orders,
    payment: async () => payments,
    token: (request) => request.headers.get("x-test-session"),
    origins: () => [origin],
  });
  const request = (body: unknown, requestOrigin = origin, session = token) =>
    new Request(origin + "/api/checkout", {
      method: "POST",
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
        "x-test-session": session,
      },
      body: JSON.stringify(body),
    });
  expect((await handler(request({}, "https://evil.example"), "checkout")).status).toBe(403);
  const empty = await carts.read(token),
    cart = await carts.mutate(token, {
      operation: "add",
      cartId: empty.id,
      revision: empty.revision,
      productId: String(productId),
      quantity: 1,
      additionIds: [],
    });
  const command = { cartId: cart.id, revision: cart.revision, idempotencyKey: "http-checkout-123" };
  expect((await handler(request(command, origin, otherToken), "checkout")).status).toBe(409);
  expect((await handler(request({ ...command, totalToman: 1 }), "checkout")).status).toBe(400);
  const response = await handler(request(command), "checkout");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result.value.payment.amountToman).toBe(100000);
});

test("customer result is owner-scoped, remains pending until confirmation and is idempotent on refresh", async () => {
  const { intent, payment } = await checkout();
  const pending = await readCustomerPaymentResult(connection, orders.service, token, intent.id);
  expect(pending.payment).toMatchObject({ status: "pending", amountToman: payment.amountToman });
  expect(pending.order).toBeNull();
  await expect(
    readCustomerPaymentResult(connection, orders.service, otherToken, intent.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await settle(payment);
  const first = await readCustomerPaymentResult(connection, orders.service, token, intent.id);
  const replay = await readCustomerPaymentResult(connection, orders.service, token, intent.id);
  expect(first.checkout.state).toBe("CONFIRMED");
  expect(first.payment?.status).toBe("succeeded");
  expect(first.order?.code).toMatch(/^AC-\d{7,}$/u);
  expect(replay).toEqual(first);
  await expect(orders.service.detail(otherToken, first.order!.id, true)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
