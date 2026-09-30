import "server-only";

import type { ClientSession, Connection } from "mongoose";
import { Types } from "mongoose";

import { ApplicationError } from "../../../../shared/errors.ts";
export async function validateProductCategory(
  connection: Connection,
  session: ClientSession,
  id: string | null,
  published: boolean,
) {
  const guard = await connection
    .db!.collection<{ _id: string }>("category_order_guard")
    .updateOne({ _id: "catalog" }, { $inc: { revision: 1 } }, { session });
  if (!guard.matchedCount)
    throw new ApplicationError("UNAVAILABLE", "Category order migration required");
  if (!id) return;
  const category = await connection
    .db!.collection("categories")
    .findOne(
      { _id: new Types.ObjectId(id), deletedAt: null },
      { session, projection: { status: 1 } },
    );
  if (!category || (published && category.status !== "published"))
    throw new ApplicationError(
      "CONFLICT",
      "Product requires an existing category; published products need an active category",
    );
}
export async function publicProductCategories(connection: Connection, session: ClientSession) {
  const rows = await connection
    .db!.collection("categories")
    .find(
      { status: "published", deletedAt: null },
      { session, projection: { name: 1, sortOrder: 1 } },
    )
    .sort({ sortOrder: 1, _id: 1 })
    .limit(501)
    .toArray();
  if (rows.length > 500)
    throw new ApplicationError("CONFLICT", "Menu has too many categories for a bounded response");
  return rows.map((r) => ({
    id: String(r._id),
    name: String(r.name),
    sortOrder: Number(r.sortOrder),
  }));
}
