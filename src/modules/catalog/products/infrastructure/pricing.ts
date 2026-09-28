import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../../shared/errors.ts";

/** Trusted server projection: bounded batches, never an admin document or browser input. */
export async function productPricingProjection(
  connection: Connection,
  ids: string[],
  session: ClientSession,
) {
  if (ids.length > 50 || ids.some((id) => !/^[a-f\d]{24}$/u.test(id)))
    throw new ApplicationError("VALIDATION", "Invalid pricing batch");
  const db = connection.db!;
  const products = await db
    .collection<{
      _id: Types.ObjectId;
      categoryId: Types.ObjectId;
      name: string;
      basePriceToman: number;
      status: string;
      available: boolean;
      deletedAt: Date | null;
    }>("products")
    .find(
      { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
      {
        session,
        projection: {
          categoryId: 1,
          name: 1,
          basePriceToman: 1,
          status: 1,
          available: 1,
          deletedAt: 1,
        },
      },
    )
    .limit(50)
    .maxTimeMS(2500)
    .toArray();
  const categoryIds = [...new Set(products.map((p) => String(p.categoryId)))].map(
    (id) => new Types.ObjectId(id),
  );
  const categories = await db
    .collection("categories")
    .find(
      { _id: { $in: categoryIds }, status: "published", deletedAt: null },
      { session, projection: { _id: 1, name: 1 } },
    )
    .limit(50)
    .maxTimeMS(2500)
    .toArray();
  const active = new Set(categories.map((c) => String(c._id)));
  const additions = await db
    .collection<{
      _id: Types.ObjectId;
      productId: Types.ObjectId;
      name: string;
      priceToman: number;
      available: boolean;
    }>("product_additions")
    .find(
      { productId: { $in: products.map((p) => p._id) } },
      { session, projection: { productId: 1, name: 1, priceToman: 1, available: 1 } },
    )
    .limit(2001)
    .maxTimeMS(2500)
    .toArray();
  if (additions.length > 2000)
    throw new ApplicationError("UNAVAILABLE", "Catalog addition bound exceeded");
  const grouped = new Map<
    string,
    { id: string; name: string; priceToman: number; available: boolean }[]
  >();
  for (const a of additions) {
    const key = String(a.productId);
    const list = grouped.get(key) ?? [];
    list.push({
      id: String(a._id),
      name: a.name,
      priceToman: a.priceToman,
      available: a.available,
    });
    grouped.set(key, list);
  }
  return new Map(
    products.map((p) => [
      String(p._id),
      {
        id: String(p._id),
        name: p.name,
        categoryName: String(
          categories.find((c) => String(c._id) === String(p.categoryId))?.name ?? "",
        ),
        basePriceToman: p.basePriceToman,
        available:
          p.status === "published" &&
          p.available &&
          !p.deletedAt &&
          active.has(String(p.categoryId)),
        additions: grouped.get(String(p._id)) ?? [],
      },
    ]),
  );
}
