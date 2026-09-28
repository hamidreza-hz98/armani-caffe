import "server-only";

import type { ClientSession, Connection } from "mongoose";
export const version = 11;
export const description =
  "Order status normalization, durable checkout, counter and sales projection";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession) {
  const orders = db.collection("orders");
  for (const [from, to] of Object.entries({
    placed: "NEW",
    preparing: "PREPARING",
    ready: "READY",
    completed: "COMPLETED",
    cancelled: "CANCELLED",
  }))
    await orders.updateMany({ status: from }, { $set: { status: to } }, { session });
  const codes = await orders.find({}, { session, projection: { code: 1 } }).toArray();
  let max = 0;
  for (const row of codes) {
    if (
      typeof row.code !== "string" ||
      !/^AC-\d{7,}$/u.test(row.code) ||
      !Number.isSafeInteger(Number(row.code.slice(3)))
    )
      throw new Error("Legacy order code requires explicit reconciliation");
    max = Math.max(max, Number(row.code.slice(3)));
  }
  await db
    .collection<{ _id: string; sequence: number }>("order_counters")
    .updateOne({ _id: "orders" }, { $max: { sequence: max } }, { session, upsert: true });
  const sales = await orders
    .aggregate(
      [
        {
          $match: {
            paymentStatus: "paid",
            status: { $in: ["NEW", "PREPARING", "READY", "COMPLETED"] },
          },
        },
        { $unwind: "$items" },
        { $group: { _id: "$items.productId", count: { $sum: "$items.quantity" } } },
      ],
      { session },
    )
    .toArray();
  await db.collection("order_sales_projection").deleteMany({}, { session });
  if (sales.length) await db.collection("order_sales_projection").insertMany(sales, { session });
}
