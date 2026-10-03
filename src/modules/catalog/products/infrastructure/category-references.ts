import "server-only";

import type { ClientSession, Connection } from "mongoose";
import { Types } from "mongoose";

/** Product module owns this persistence query; Categories gets only the public port. */
export async function productCategoryDependencies(
  connection: Connection,
  tx: ClientSession,
  categoryId: string,
) {
  return connection
    .db!.collection("products")
    .countDocuments(
      { categoryId: new Types.ObjectId(categoryId), deletedAt: null },
      { session: tx },
    );
}

/** Bounded dashboard projection; the product module keeps ownership of its collection. */
export async function productCategoryCounts(
  connection: Connection,
  categoryIds: readonly string[],
): Promise<Record<string, number>> {
  if (!categoryIds.length) return {};
  const rows = await connection
    .db!.collection("products")
    .aggregate<{ _id: Types.ObjectId; count: number }>(
      [
        {
          $match: {
            deletedAt: null,
            categoryId: { $in: categoryIds.map((id) => new Types.ObjectId(id)) },
          },
        },
        { $group: { _id: "$categoryId", count: { $sum: 1 } } },
        { $limit: 500 },
      ],
      { maxTimeMS: 2500 },
    )
    .toArray();
  return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
}
