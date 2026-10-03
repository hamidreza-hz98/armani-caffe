import "server-only";

import type { Filter, Sort } from "mongodb";
import { Types } from "mongoose";

import { tehranDashboardPeriod, tehranWindowStart } from "@/modules/analytics";
import { getDatabaseConnection } from "@/server/database/connection";
import { ApplicationError } from "@/shared/errors";

import type { OrderFilters, OrderList, OrderRow } from "./model";

type DbOrder = {
  _id: Types.ObjectId;
  code: string;
  customer: { displayName: string | null; phone: string };
  items: { productName: string; quantity: number }[];
  totalToman: number;
  status: OrderRow["status"];
  paymentStatus: OrderRow["paymentStatus"];
  __v: number;
  placedAt: Date;
};
function searchFilter(q: string): Filter<DbOrder> {
  if (!q) return {};
  const normalized = q
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const code = normalized.toUpperCase();
  if (/^AC-\d{1,12}$/u.test(code)) return { code: { $regex: `^${code}` } };
  const digits = normalized.replace(/[\s-]/gu, "");
  if (/^(?:\+98|0)?9\d{9}$/u.test(digits)) {
    const phone = digits.startsWith("+98") ? digits : `+98${digits.replace(/^0/u, "")}`;
    return { "customer.phone": phone };
  }
  return { code: "__no_matching_order_code__" };
}
export async function listOperationalOrders(
  filters: OrderFilters,
  now = new Date(),
): Promise<OrderList> {
  if (
    filters.page < 1 ||
    filters.page > 10000 ||
    !Number.isSafeInteger(filters.page) ||
    filters.q.length > 80
  )
    throw new ApplicationError("VALIDATION", "Invalid order filters");
  const db = (await getDatabaseConnection()).db!;
  const orders = db.collection<DbOrder>("orders");
  const start =
    filters.range === "today"
      ? tehranDashboardPeriod(now).todayStartUtc
      : filters.range === "7d" || filters.range === "30d"
        ? tehranWindowStart(now, filters.range === "7d" ? 7 : 30)
        : null;
  const filter: Filter<DbOrder> = {
    ...searchFilter(filters.q),
    ...(filters.status === "all" ? {} : { status: filters.status }),
    ...(filters.payment === "all" ? {} : { paymentStatus: filters.payment }),
    ...(start ? { placedAt: { $gte: start } } : {}),
  };
  const sort: Sort =
    filters.sort === "oldest"
      ? { placedAt: 1 as const, _id: 1 as const }
      : filters.sort === "amount-high"
        ? { totalToman: -1 as const, _id: -1 as const }
        : filters.sort === "amount-low"
          ? { totalToman: 1 as const, _id: 1 as const }
          : { placedAt: -1 as const, _id: -1 as const };
  const [rows, total, fulfillment, payment] = await Promise.all([
    orders
      .find(filter, {
        projection: {
          code: 1,
          customer: 1,
          "items.productName": 1,
          "items.quantity": 1,
          totalToman: 1,
          status: 1,
          paymentStatus: 1,
          placedAt: 1,
          __v: 1,
        },
      })
      .sort(sort)
      .skip((filters.page - 1) * 20)
      .limit(20)
      .maxTimeMS(2500)
      .toArray(),
    orders.countDocuments(filter, { maxTimeMS: 2500 }),
    orders
      .aggregate<{ _id: OrderRow["status"]; count: number }>(
        [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        { maxTimeMS: 2500 },
      )
      .toArray(),
    orders
      .aggregate<{ _id: OrderRow["paymentStatus"]; count: number }>(
        [{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } }],
        { maxTimeMS: 2500 },
      )
      .toArray(),
  ]);
  const fulfillmentCounts: OrderList["counts"]["fulfillment"] = {
    NEW: 0,
    PREPARING: 0,
    READY: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  const paymentCounts: OrderList["counts"]["payment"] = {
    unpaid: 0,
    pending: 0,
    paid: 0,
    refunded: 0,
  };
  for (const item of fulfillment)
    if (item._id in fulfillmentCounts) fulfillmentCounts[item._id] = item.count;
  for (const item of payment) if (item._id in paymentCounts) paymentCounts[item._id] = item.count;
  return {
    items: rows.map((row) => ({
      id: String(row._id),
      code: row.code,
      customerName: row.customer?.displayName ?? "مشتری",
      customerPhone: row.customer?.phone ?? "",
      summary: row.items?.map((item) => `${item.quantity}× ${item.productName}`).join("، ") ?? "",
      totalToman: row.totalToman,
      status: row.status,
      paymentStatus: row.paymentStatus,
      revision: row.__v,
      placedAt: row.placedAt.toISOString(),
    })),
    total,
    counts: { fulfillment: fulfillmentCounts, payment: paymentCounts },
  };
}
