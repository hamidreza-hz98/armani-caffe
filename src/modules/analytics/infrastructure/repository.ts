import "server-only";

import { type Connection, Types } from "mongoose";

import { asToman } from "../../../shared/domain.ts";
import type { DashboardAnalytics, SalesWindow } from "../contracts/dashboard.ts";
import { tehranDashboardPeriod } from "../domain/period.ts";

type SalesRow = {
  todaySales: number;
  todayCount: number;
  thirtyDaySales: number;
  thirtyDayCount: number;
};
type LatestRow = {
  _id: Types.ObjectId;
  code: string;
  customer?: { displayName?: string | null };
  totalToman: number;
  status: string;
  paymentStatus: "paid" | "refunded";
  placedAt: Date;
};
type CustomerRow = {
  _id: Types.ObjectId;
  displayName?: string | null;
  orderCount: number;
  spentToman: number;
};
type ProductRow = {
  _id: Types.ObjectId;
  name: string;
  quantity: number;
  salesToman: number;
};
type StockRow = {
  _id: Types.ObjectId;
  name: string;
  unit: "gram" | "milliliter" | "piece";
  onHand: number;
  reorderLevel: number;
};
const orderStatus = ["NEW", "PREPARING", "READY", "COMPLETED"];
const window = (sales: number, count: number): SalesWindow => ({
  salesToman: asToman(sales),
  orderCount: asToman(count),
  averageOrderValueToman: asToman(count ? Math.round(sales / count) : 0),
});

/** Read model only: no Mongoose documents and no persistent rollup state. */
export class MongoDashboardAnalytics {
  private readonly connection: Connection;
  private readonly now: () => Date;
  constructor(connection: Connection, now: () => Date = () => new Date()) {
    this.connection = connection;
    this.now = now;
  }
  async read(): Promise<DashboardAnalytics> {
    const period = tehranDashboardPeriod(this.now());
    const orders = this.connection.db!.collection("orders");
    const eligible = {
      paymentStatus: "paid",
      status: { $in: orderStatus },
      totalToman: { $gte: 1 },
      placedAt: { $gte: period.thirtyDayStartUtc, $lt: period.asOfUtc },
    };
    const bounded = { allowDiskUse: false, maxTimeMS: 2500 };
    const [salesRows, latestRows, customerRows, productRows, stockRows] = await Promise.all([
      orders
        .aggregate<SalesRow>(
          [
            { $match: eligible },
            {
              $group: {
                _id: null,
                thirtyDaySales: { $sum: "$totalToman" },
                thirtyDayCount: { $sum: 1 },
                todaySales: {
                  $sum: {
                    $cond: [{ $gte: ["$placedAt", period.todayStartUtc] }, "$totalToman", 0],
                  },
                },
                todayCount: {
                  $sum: { $cond: [{ $gte: ["$placedAt", period.todayStartUtc] }, 1, 0] },
                },
              },
            },
          ],
          { ...bounded, hint: "order_payment_placed" },
        )
        .toArray(),
      orders
        .aggregate<LatestRow>(
          [
            {
              $match: {
                paymentStatus: { $in: ["paid", "refunded"] },
                totalToman: { $gte: 1 },
                placedAt: { $lt: period.asOfUtc },
              },
            },
            { $sort: { placedAt: -1, _id: -1 } },
            { $limit: 10 },
            {
              $project: {
                code: 1,
                "customer.displayName": 1,
                totalToman: 1,
                status: 1,
                paymentStatus: 1,
                placedAt: 1,
              },
            },
          ],
          { ...bounded, hint: "order_recent" },
        )
        .toArray(),
      orders
        .aggregate<CustomerRow>(
          [
            { $match: { ...eligible, customerId: { $type: "objectId" } } },
            {
              $group: {
                _id: "$customerId",
                displayName: { $first: "$customer.displayName" },
                orderCount: { $sum: 1 },
                spentToman: { $sum: "$totalToman" },
              },
            },
            { $sort: { spentToman: -1, orderCount: -1, _id: 1 } },
            { $limit: 10 },
          ],
          { ...bounded, hint: "order_payment_placed" },
        )
        .toArray(),
      orders
        .aggregate<ProductRow>(
          [
            { $match: eligible },
            { $unwind: "$items" },
            { $match: { "items.productId": { $type: "objectId" } } },
            {
              $group: {
                _id: "$items.productId",
                name: { $first: "$items.productName" },
                quantity: { $sum: "$items.quantity" },
                salesToman: { $sum: "$items.lineTotalToman" },
              },
            },
            { $sort: { quantity: -1, salesToman: -1, _id: 1 } },
            { $limit: 10 },
          ],
          { ...bounded, hint: "order_payment_placed" },
        )
        .toArray(),
      this.connection
        .db!.collection("inventory_items")
        .aggregate<StockRow>(
          [
            {
              $match: {
                status: "active",
                onHand: { $gte: 0 },
                reorderLevel: { $gte: 0 },
                $expr: { $lte: ["$onHand", "$reorderLevel"] },
              },
            },
            { $sort: { onHand: 1, _id: 1 } },
            { $limit: 10 },
            { $project: { name: 1, unit: 1, onHand: 1, reorderLevel: 1 } },
          ],
          { ...bounded, hint: "inventory_low_stock_dashboard" },
        )
        .toArray(),
    ]);
    const sales = salesRows[0] ?? {
      todaySales: 0,
      todayCount: 0,
      thirtyDaySales: 0,
      thirtyDayCount: 0,
    };
    return {
      timezone: period.timezone,
      localDate: period.localDate,
      asOfUtc: period.asOfUtc.toISOString(),
      today: window(sales.todaySales, sales.todayCount),
      thirtyDays: window(sales.thirtyDaySales, sales.thirtyDayCount),
      latestOrders: latestRows.map((row) => ({
        id: String(row._id),
        code: row.code,
        customerName: row.customer?.displayName ?? null,
        totalToman: asToman(row.totalToman),
        status: row.status,
        paymentStatus: row.paymentStatus,
        placedAt: row.placedAt.toISOString(),
      })),
      bestCustomers: customerRows.map((row) => ({
        customerId: String(row._id),
        displayName: row.displayName ?? null,
        orderCount: asToman(row.orderCount),
        spentToman: asToman(row.spentToman),
      })),
      bestProducts: productRows.map((row) => ({
        productId: String(row._id),
        name: row.name,
        quantity: asToman(row.quantity),
        salesToman: asToman(row.salesToman),
      })),
      lowStock: stockRows.map((row) => ({
        id: String(row._id),
        name: row.name,
        unit: row.unit,
        onHand: asToman(row.onHand),
        reorderLevel: asToman(row.reorderLevel),
      })),
    };
  }
}
