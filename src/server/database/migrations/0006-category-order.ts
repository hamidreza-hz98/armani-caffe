import "server-only";

import type { ClientSession, Connection } from "mongoose";

export const version = 6;
export const description = "Initialize category order guard and backfill safe media references";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession, now: Date) {
  const rows = await db
    .collection("categories")
    .find({ deletedAt: null }, { session })
    .sort({ sortOrder: 1, _id: 1 })
    .toArray();
  if (rows.length > 500)
    throw new Error("Category migration needs operator review: more than 500 active categories");
  for (const [index, row] of rows.entries()) {
    if (!Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0)
      throw new Error("Category migration needs operator review: invalid order");
    if (row.mediaId) {
      const asset = await db
        .collection("media_assets")
        .findOneAndUpdate(
          { _id: row.mediaId },
          { $inc: { referenceGuard: 1 } },
          { session, returnDocument: "after" },
        );
      if (!asset || asset.status !== "ready" || asset.visibility !== "public" || asset.deletedAt)
        throw new Error("Category migration needs operator review: unsafe media reference");
      await db.collection("media_references").updateOne(
        { entityKind: "category", entityId: row._id, field: "mediaId", mediaId: row.mediaId },
        {
          $setOnInsert: {
            entityKind: "category",
            entityId: row._id,
            field: "mediaId",
            mediaId: row.mediaId,
            createdAt: now,
            updatedAt: now,
            __v: 0,
          },
        },
        { upsert: true, session },
      );
    }
    if (row.sortOrder !== index)
      await db
        .collection("categories")
        .updateOne(
          { _id: row._id },
          { $set: { sortOrder: index, updatedAt: now }, $inc: { __v: 1 } },
          { session },
        );
  }
  await db
    .collection<{ _id: string; revision: number }>("category_order_guard")
    .updateOne({ _id: "catalog" }, { $setOnInsert: { revision: 0 } }, { upsert: true, session });
}
