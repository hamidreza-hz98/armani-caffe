import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";
export async function productSoldCounts(
  connection: Connection,
  session: ClientSession,
  ids: string[],
) {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  const rows = await connection
    .db!.collection("orders")
    .aggregate<{ _id: Types.ObjectId; count: number }>(
      [
        {
          $match: {
            paymentStatus: "paid",
            status: { $in: ["NEW", "PREPARING", "READY", "COMPLETED"] },
            "items.productId": { $in: objectIds },
          },
        },
        { $unwind: "$items" },
        { $match: { "items.productId": { $in: objectIds } } },
        { $group: { _id: "$items.productId", count: { $sum: "$items.quantity" } } },
      ],
      { session, maxTimeMS: 2500 },
    )
    .toArray();
  return new Map(rows.map((row) => [String(row._id), row.count]));
}
