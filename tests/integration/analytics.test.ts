import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import {
  createDashboardAnalyticsHttp,
  DashboardAnalyticsService,
  MongoDashboardAnalytics,
  MongoOverviewWidgets,
} from "@/modules/analytics/server";
import { applyDatabaseIndexes } from "@/server/database/operations";
import { ApplicationError } from "@/shared/errors";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;
const now = () => new Date("2026-06-01T21:00:00.000Z"); // 00:30 June 2 in Tehran
const oid = () => new mongoose.Types.ObjectId();
const customerA = oid();
const customerB = oid();
const productA = oid();
const productB = oid();
const order = (
  date: string,
  total: number,
  status = "NEW",
  paymentStatus = "paid",
  customerId: mongoose.Types.ObjectId | null = customerA,
  productId = productA,
) => ({
  _id: oid(),
  code: `AC-${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`,
  idempotencyKey: String(oid()),
  placedAt: new Date(date),
  totalToman: total,
  status,
  paymentStatus,
  customerId,
  customer: customerId ? { displayName: customerId.equals(customerA) ? "مریم" : "علی" } : {},
  items: [
    {
      productId,
      productName: productId.equals(productA) ? "لاته" : "چای",
      quantity: 1,
      lineTotalToman: total,
    },
  ],
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
    .createConnection(replica.getUri(isolatedResources("analytics").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
});
beforeEach(async () => {
  await connection.db!.collection("orders").deleteMany({});
  await connection.db!.collection("inventory_items").deleteMany({});
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  if (replica) await replica.stop();
});

test("empty dashboard has zero monetary metrics and bounded empty lists", async () => {
  const dashboard = await new MongoDashboardAnalytics(connection, now).read();
  expect(dashboard.today).toEqual({ salesToman: 0, orderCount: 0, averageOrderValueToman: 0 });
  expect(dashboard.thirtyDays).toEqual(dashboard.today);
  expect(dashboard.latestOrders).toEqual([]);
  expect(dashboard.bestCustomers).toEqual([]);
  expect(dashboard.bestProducts).toEqual([]);
  expect(dashboard.lowStock).toEqual([]);
  const overview = new MongoOverviewWidgets(connection, now);
  expect((await overview.sales(30)).selected).toEqual(dashboard.thirtyDays);
  expect(await overview.trend(30)).toHaveLength(30);
  expect((await overview.trend(30)).every((point) => point.salesToman === 0)).toBe(true);
  expect(await overview.attention()).toEqual({ count: 0, recent: [] });
  expect(await overview.lowStock()).toEqual({ count: 0, items: [] });
});

test("paid snapshots reconcile across Tehran midnight; failed/refunded/cancelled are excluded", async () => {
  await connection
    .db!.collection("orders")
    .insertMany([
      order("2026-06-01T20:29:59.999Z", 100, "COMPLETED", "paid", customerA, productA),
      order("2026-06-01T20:30:00.000Z", 200, "NEW", "paid", customerA, productB),
      order("2026-06-01T20:45:00.000Z", 300, "READY", "paid", customerB, productA),
      order("2026-06-01T20:40:00.000Z", 400, "NEW", "pending"),
      order("2026-06-01T20:40:00.000Z", 500, "CANCELLED", "paid"),
      order("2026-06-01T20:40:00.000Z", 600, "CANCELLED", "refunded"),
      order("2026-05-03T20:29:59.999Z", 700, "COMPLETED", "paid"),
      order("2026-06-01T21:00:00.000Z", 800, "NEW", "paid"),
      order("2026-06-01T20:50:00.000Z", 900, "NEW", "paid", null),
    ]);
  await connection.db!.collection("inventory_items").insertMany([
    { _id: oid(), name: "شیر", status: "active", onHand: 0, reorderLevel: 5, unit: "milliliter" },
    { _id: oid(), name: "قهوه", status: "active", onHand: 5, reorderLevel: 5, unit: "gram" },
    { _id: oid(), name: "چای", status: "active", onHand: 10, reorderLevel: 5, unit: "gram" },
    { _id: oid(), name: "قدیمی", status: "archived", onHand: 0, reorderLevel: 5, unit: "piece" },
  ]);
  const dashboard = await new MongoDashboardAnalytics(connection, now).read();
  expect(dashboard.localDate).toBe("2026-06-02");
  expect(dashboard.today).toEqual({ salesToman: 1400, orderCount: 3, averageOrderValueToman: 467 });
  expect(dashboard.thirtyDays).toEqual({
    salesToman: 1500,
    orderCount: 4,
    averageOrderValueToman: 375,
  });
  expect(dashboard.bestCustomers).toMatchObject([
    { customerId: String(customerA), spentToman: 300, orderCount: 2 },
    { customerId: String(customerB), spentToman: 300, orderCount: 1 },
  ]);
  expect(dashboard.bestProducts).toMatchObject([
    { productId: String(productA), name: "لاته", quantity: 3, salesToman: 1300 },
    { productId: String(productB), name: "چای", quantity: 1, salesToman: 200 },
  ]);
  expect(dashboard.lowStock.map((item) => item.name)).toEqual(["شیر", "قهوه"]);
  expect(dashboard.latestOrders).toHaveLength(7);
  expect(dashboard.latestOrders.some((item) => item.paymentStatus === "refunded")).toBe(true);
  expect(JSON.stringify(dashboard)).not.toMatch(/phone|passwordHash|transactionId/u);
  const overview = new MongoOverviewWidgets(connection, now);
  const [sales, trend, attention, stock, latest, products, customers] = await Promise.all([
    overview.sales(30),
    overview.trend(30),
    overview.attention(),
    overview.lowStock(),
    overview.latestOrders(),
    overview.bestProducts(),
    overview.bestCustomers(),
  ]);
  expect(sales.today).toEqual(dashboard.today);
  expect(sales.selected).toEqual(dashboard.thirtyDays);
  expect(trend).toHaveLength(30);
  expect(trend.at(-1)).toMatchObject({ date: "2026-06-02", salesToman: 1400, orderCount: 3 });
  expect(trend.at(-2)).toMatchObject({ date: "2026-06-01", salesToman: 100, orderCount: 1 });
  expect(attention.count).toBe(3);
  expect(stock.count).toBe(2);
  expect(stock.items.map((item) => item.name)).toEqual(dashboard.lowStock.map((item) => item.name));
  expect(latest).toEqual(dashboard.latestOrders);
  expect(products).toEqual(dashboard.bestProducts);
  expect(customers).toEqual(dashboard.bestCustomers);
  expect((await overview.sales(7)).selected).toEqual(dashboard.thirtyDays);
});

test("lists cap at ten; explain plans use the declared indexes", async () => {
  await connection
    .db!.collection("orders")
    .insertMany(
      Array.from({ length: 12 }, (_, index) =>
        order(
          `2026-06-01T20:${String(index + 30).padStart(2, "0")}:00.000Z`,
          100 + index,
          "NEW",
          "paid",
          oid(),
          oid(),
        ),
      ),
    );
  await connection.db!.collection("inventory_items").insertMany(
    Array.from({ length: 12 }, (_, index) => ({
      _id: oid(),
      name: `item-${index}`,
      status: "active",
      onHand: 0,
      reorderLevel: 1,
      unit: "piece",
    })),
  );
  const dashboard = await new MongoDashboardAnalytics(connection, now).read();
  for (const list of [
    dashboard.latestOrders,
    dashboard.bestCustomers,
    dashboard.bestProducts,
    dashboard.lowStock,
  ])
    expect(list).toHaveLength(10);
  const orders = connection.db!.collection("orders");
  const datePlan = await orders
    .aggregate(
      [{ $match: { paymentStatus: "paid", placedAt: { $gte: new Date("2026-05-01") } } }],
      { hint: "order_payment_placed" },
    )
    .explain("queryPlanner");
  const latestPlan = await orders
    .aggregate(
      [
        { $match: { paymentStatus: { $in: ["paid", "refunded"] } } },
        { $sort: { placedAt: -1, _id: -1 } },
        { $limit: 10 },
      ],
      { hint: "order_recent" },
    )
    .explain("queryPlanner");
  const stockPlan = await connection
    .db!.collection("inventory_items")
    .aggregate(
      [
        { $match: { status: "active", $expr: { $lte: ["$onHand", "$reorderLevel"] } } },
        { $sort: { onHand: 1, _id: 1 } },
        { $limit: 10 },
      ],
      { hint: "inventory_low_stock_dashboard" },
    )
    .explain("queryPlanner");
  expect(JSON.stringify(datePlan)).toContain("order_payment_placed");
  expect(JSON.stringify(latestPlan)).toContain("order_recent");
  expect(JSON.stringify(stockPlan)).toContain("inventory_low_stock_dashboard");
});

test("URL-selected seven-day sales exclude older days while the thirty-day trend retains them", async () => {
  await connection
    .db!.collection("orders")
    .insertMany([order("2026-05-20T12:00:00.000Z", 700), order("2026-05-31T12:00:00.000Z", 300)]);
  const overview = new MongoOverviewWidgets(connection, now);
  expect((await overview.sales(7)).selected).toMatchObject({ salesToman: 300, orderCount: 1 });
  expect((await overview.sales(30)).selected).toMatchObject({ salesToman: 1000, orderCount: 2 });
  expect((await overview.trend(7)).reduce((sum, day) => sum + day.salesToman, 0)).toBe(300);
  expect((await overview.trend(30)).reduce((sum, day) => sum + day.salesToman, 0)).toBe(1000);
});

test("service and HTTP deny unauthenticated or unauthorized readers before querying", async () => {
  let reads = 0;
  const service = new DashboardAnalyticsService(
    {
      read: async () => {
        reads++;
        return new MongoDashboardAnalytics(connection, now).read();
      },
    },
    async (token) => {
      if (token !== "owner") throw new ApplicationError("FORBIDDEN", "Capability required");
      return { id: String(oid()), role: "OWNER" };
    },
  );
  const handle = createDashboardAnalyticsHttp({
    service: async () => service,
    token: (request) => request.headers.get("x-test-token"),
  });
  expect((await handle(new Request("http://localhost/api/admin/analytics/dashboard"))).status).toBe(
    401,
  );
  expect(
    (
      await handle(
        new Request("http://localhost/api/admin/analytics/dashboard", {
          headers: { "x-test-token": "cashier" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(reads).toBe(0);
  const response = await handle(
    new Request("http://localhost/api/admin/analytics/dashboard", {
      headers: { "x-test-token": "owner" },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(reads).toBe(1);
});
