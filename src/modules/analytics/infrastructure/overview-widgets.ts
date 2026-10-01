import "server-only";

import { type Connection, Types } from "mongoose";

import { asToman } from "../../../shared/domain.ts";
import type {
  OverviewAttention,
  OverviewCustomer,
  OverviewDay,
  OverviewOrder,
  OverviewProduct,
  OverviewRange,
  OverviewSales,
  OverviewStock,
} from "../contracts/overview.ts";
import { tehranDashboardPeriod, tehranWindowStart } from "../domain/period.ts";

type SalesRow = {
  todaySales: number;
  todayCount: number;
  selectedSales: number;
  selectedCount: number;
};
type TrendRow = { _id: string; salesToman: number; orderCount: number };
type OrderRow = {
  _id: Types.ObjectId;
  code: string;
  customer?: { displayName?: string | null };
  totalToman: number;
  status: string;
  paymentStatus: "paid" | "refunded";
  placedAt: Date;
};
type StockRow = {
  _id: Types.ObjectId;
  name: string;
  unit: "gram" | "milliliter" | "piece";
  onHand: number;
  reorderLevel: number;
};
type ProductRow = { _id: Types.ObjectId; name: string; quantity: number; salesToman: number };
type CustomerRow = {
  _id: Types.ObjectId;
  displayName?: string | null;
  orderCount: number;
  spentToman: number;
};
const validStatuses = ["NEW", "PREPARING", "READY", "COMPLETED"];
const bounded = { allowDiskUse: false, maxTimeMS: 2500 };
const salesWindow = (sales: number, count: number) => ({
  salesToman: asToman(sales),
  orderCount: asToman(count),
  averageOrderValueToman: asToman(count ? Math.round(sales / count) : 0),
});

export class MongoOverviewWidgets {
  constructor(
    private readonly connection: Connection,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private orders() {
    return this.connection.db!.collection("orders");
  }
  private stock() {
    return this.connection.db!.collection("inventory_items");
  }
  private eligible(range: OverviewRange, asOf: Date) {
    return {
      paymentStatus: "paid",
      status: { $in: validStatuses },
      totalToman: { $gte: 1 },
      placedAt: { $gte: tehranWindowStart(asOf, range), $lt: asOf },
    };
  }

  async sales(range: OverviewRange): Promise<OverviewSales> {
    const asOf = this.now(),
      period = tehranDashboardPeriod(asOf);
    const rows = await this.orders()
      .aggregate<SalesRow>(
        [
          { $match: this.eligible(range, asOf) },
          {
            $group: {
              _id: null,
              selectedSales: { $sum: "$totalToman" },
              selectedCount: { $sum: 1 },
              todaySales: {
                $sum: { $cond: [{ $gte: ["$placedAt", period.todayStartUtc] }, "$totalToman", 0] },
              },
              todayCount: {
                $sum: { $cond: [{ $gte: ["$placedAt", period.todayStartUtc] }, 1, 0] },
              },
            },
          },
        ],
        { ...bounded, hint: "order_payment_placed" },
      )
      .toArray();
    const row = rows[0] ?? { todaySales: 0, todayCount: 0, selectedSales: 0, selectedCount: 0 };
    return {
      localDate: period.localDate,
      asOfUtc: asOf.toISOString(),
      today: salesWindow(row.todaySales, row.todayCount),
      selected: salesWindow(row.selectedSales, row.selectedCount),
    };
  }

  async trend(range: OverviewRange): Promise<readonly OverviewDay[]> {
    const asOf = this.now(),
      period = tehranDashboardPeriod(asOf);
    const rows = await this.orders()
      .aggregate<TrendRow>(
        [
          { $match: this.eligible(range, asOf) },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$placedAt", timezone: "Asia/Tehran" },
              },
              salesToman: { $sum: "$totalToman" },
              orderCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        { ...bounded, hint: "order_payment_placed" },
      )
      .toArray();
    const byDay = new Map(rows.map((row) => [row._id, row]));
    const [year, month, day] = period.localDate.split("-").map(Number);
    return Array.from({ length: range }, (_, index) => {
      const date = new Date(Date.UTC(year!, month! - 1, day! - range + index + 1))
        .toISOString()
        .slice(0, 10);
      const row = byDay.get(date);
      return {
        date,
        salesToman: asToman(row?.salesToman ?? 0),
        orderCount: asToman(row?.orderCount ?? 0),
      };
    });
  }

  async attention(): Promise<OverviewAttention> {
    const filter = {
      paymentStatus: "paid",
      status: { $in: ["NEW", "PREPARING", "READY"] },
      placedAt: { $lt: this.now() },
    };
    const [count, rows] = await Promise.all([
      this.orders().countDocuments(filter, { hint: "order_recent", maxTimeMS: 2500 }),
      this.orders()
        .find(filter, { projection: { code: 1, status: 1, placedAt: 1 } })
        .sort({ placedAt: -1, _id: -1 })
        .limit(3)
        .hint("order_recent")
        .maxTimeMS(2500)
        .toArray(),
    ]);
    return {
      count: asToman(count),
      recent: rows.map((row) => ({
        code: String(row.code),
        status: String(row.status),
        placedAt: (row.placedAt as Date).toISOString(),
      })),
    };
  }

  async lowStock(): Promise<OverviewStock> {
    const filter = {
      status: "active",
      onHand: { $gte: 0 },
      reorderLevel: { $gte: 0 },
      $expr: { $lte: ["$onHand", "$reorderLevel"] },
    };
    const [count, rows] = await Promise.all([
      this.stock().countDocuments(filter, {
        hint: "inventory_low_stock_dashboard",
        maxTimeMS: 2500,
      }),
      this.stock()
        .aggregate<StockRow>(
          [
            { $match: filter },
            { $sort: { onHand: 1, _id: 1 } },
            { $limit: 10 },
            { $project: { name: 1, unit: 1, onHand: 1, reorderLevel: 1 } },
          ],
          { ...bounded, hint: "inventory_low_stock_dashboard" },
        )
        .toArray(),
    ]);
    return {
      count: asToman(count),
      items: rows.map((row) => ({
        id: String(row._id),
        name: row.name,
        unit: row.unit,
        onHand: asToman(row.onHand),
        reorderLevel: asToman(row.reorderLevel),
      })),
    };
  }

  async latestOrders(): Promise<readonly OverviewOrder[]> {
    const rows = await this.orders()
      .aggregate<OrderRow>(
        [
          {
            $match: {
              paymentStatus: { $in: ["paid", "refunded"] },
              totalToman: { $gte: 1 },
              placedAt: { $lt: this.now() },
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
      .toArray();
    return rows.map((row) => ({
      id: String(row._id),
      code: row.code,
      customerName: row.customer?.displayName ?? null,
      totalToman: asToman(row.totalToman),
      status: row.status,
      paymentStatus: row.paymentStatus,
      placedAt: row.placedAt.toISOString(),
    }));
  }

  async bestProducts(): Promise<readonly OverviewProduct[]> {
    const rows = await this.orders()
      .aggregate<ProductRow>(
        [
          { $match: this.eligible(30, this.now()) },
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
      .toArray();
    return rows.map((row) => ({
      productId: String(row._id),
      name: row.name,
      quantity: asToman(row.quantity),
      salesToman: asToman(row.salesToman),
    }));
  }

  async bestCustomers(): Promise<readonly OverviewCustomer[]> {
    const rows = await this.orders()
      .aggregate<CustomerRow>(
        [
          { $match: { ...this.eligible(30, this.now()), customerId: { $type: "objectId" } } },
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
      .toArray();
    return rows.map((row) => ({
      customerId: String(row._id),
      displayName: row.displayName ?? null,
      orderCount: asToman(row.orderCount),
      spentToman: asToman(row.spentToman),
    }));
  }
}
