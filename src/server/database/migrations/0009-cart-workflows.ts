import "server-only";

import type { ClientSession, Connection } from "mongoose";
export const version = 9;
export const description = "Prepare customer carts and reject ambiguous legacy active carts";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession, now: Date) {
  const duplicates = await db
    .collection("carts")
    .aggregate(
      [
        { $match: { status: "active", customerId: { $type: "objectId" } } },
        { $group: { _id: "$customerId", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 },
      ],
      { session },
    )
    .toArray();
  if (duplicates.length)
    throw new Error(
      "Duplicate active customer carts require operator review before index application",
    );
  // Legacy ephemeral carts may exceed the new bounds or have duplicate selections. Never silently merge them.
  for (const row of await db
    .collection("carts")
    .find({ status: "active" }, { session })
    .toArray()) {
    if (
      !Array.isArray(row.items) ||
      row.items.length > 50 ||
      row.items.some(
        (i: { quantity: number; additions: unknown[] }) =>
          !Number.isSafeInteger(i.quantity) ||
          i.quantity < 1 ||
          i.quantity > 100 ||
          !Array.isArray(i.additions) ||
          i.additions.length > 20,
      )
    )
      throw new Error("Legacy cart requires operator review");
    const keys = row.items.map(
      (item: { productId: unknown; additions: { additionId: unknown; priceToman: number }[] }) => {
        const additionIds = item.additions.map((a) => String(a.additionId));
        if (
          new Set(additionIds).size !== additionIds.length ||
          item.additions.some((a) => !Number.isSafeInteger(a.priceToman) || a.priceToman < 0)
        )
          throw new Error("Legacy cart additions require operator review");
        return [String(item.productId), ...additionIds.sort()].join(":");
      },
    );
    if (
      new Set(keys).size !== keys.length ||
      typeof (row.notes ?? "") !== "string" ||
      (row.notes ?? "").length > 1000
    )
      throw new Error("Legacy cart selections require operator review");
    await db
      .collection("carts")
      .updateOne(
        { _id: row._id },
        { $set: { notes: row.notes ?? "", updatedAt: now } },
        { session },
      );
  }
}
