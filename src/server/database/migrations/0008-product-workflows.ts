import "server-only";

import { type ClientSession, type Connection } from "mongoose";
export const version = 8;
export const description =
  "Backfill product presentation fields and safe addition media references";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession, now: Date) {
  // Explicit rollout only: inspect legacy records before enabling runtime workflows.
  for (const row of await db
    .collection("products")
    .find({ deletedAt: null }, { session })
    .toArray()) {
    const excerpt = row.excerpt ?? String(row.description ?? "").slice(0, 300),
      ingredients = row.ingredients ?? "";
    if (
      !Number.isSafeInteger(row.basePriceToman) ||
      row.basePriceToman < 0 ||
      !Number.isSafeInteger(row.sortOrder) ||
      row.sortOrder < 0 ||
      !["draft", "published", "archived"].includes(row.status) ||
      !Array.isArray(row.mediaIds) ||
      row.mediaIds.length > 40 ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      typeof excerpt !== "string" ||
      excerpt.length > 300 ||
      typeof ingredients !== "string" ||
      ingredients.length > 2000
    )
      throw new Error("Legacy product fields require operator review");
    const category = await db
      .collection("categories")
      .findOne({ _id: row.categoryId, deletedAt: null }, { session });
    if (
      !category ||
      (row.status === "published" &&
        (category.status !== "published" ||
          !excerpt ||
          row.basePriceToman <= 0 ||
          !row.mediaIds?.length))
    )
      throw new Error("Legacy product requires operator review before publishing");
    if (row.status === "published")
      for (const rule of await db
        .collection("product_consumption_rules")
        .find({ productId: row._id, active: true }, { session })
        .toArray()) {
        const item = await db
          .collection("inventory_items")
          .findOne({ _id: rule.inventoryItemId, status: "active" }, { session });
        if (
          !item ||
          !["gram", "milliliter", "piece"].includes(item.unit) ||
          !Number.isSafeInteger(rule.quantityPerUnit) ||
          rule.quantityPerUnit <= 0
        )
          throw new Error("Legacy published stock mapping requires operator review");
      }
    const additions = await db
      .collection("product_additions")
      .find({ productId: row._id }, { session })
      .sort({ sortOrder: 1, _id: 1 })
      .toArray();
    if (additions.length > 40) throw new Error("Legacy product has too many additions");
    if (
      additions.some(
        (a) =>
          !Number.isSafeInteger(a.priceToman) ||
          a.priceToman < 0 ||
          !Number.isSafeInteger(a.sortOrder) ||
          a.sortOrder < 0 ||
          typeof a.name !== "string" ||
          !a.name.trim(),
      )
    )
      throw new Error("Legacy addition fields require operator review");
    for (const mediaId of [
      ...(row.mediaIds ?? []),
      ...additions.flatMap((a) => (a.mediaId ? [a.mediaId] : [])),
    ]) {
      const asset = await db
        .collection("media_assets")
        .findOneAndUpdate(
          { _id: mediaId },
          { $inc: { referenceGuard: 1 } },
          { session, returnDocument: "after" },
        );
      if (!asset || asset.status !== "ready" || asset.visibility !== "public" || asset.deletedAt)
        throw new Error("Legacy product media requires operator review");
    }
    for (const mediaId of row.mediaIds ?? [])
      await db
        .collection("media_references")
        .updateOne(
          { entityKind: "product", entityId: row._id, field: "mediaIds", mediaId },
          { $setOnInsert: { createdAt: now, updatedAt: now, __v: 0 } },
          { upsert: true, session },
        );
    for (const [index, addition] of additions.entries()) {
      await db
        .collection("product_additions")
        .updateOne(
          { _id: addition._id },
          { $set: { sortOrder: index, mediaId: addition.mediaId ?? null } },
          { session },
        );
      if (addition.mediaId)
        await db.collection("media_references").updateOne(
          {
            entityKind: "product",
            entityId: row._id,
            field: "additionMediaIds",
            mediaId: addition.mediaId,
          },
          { $setOnInsert: { createdAt: now, updatedAt: now, __v: 0 } },
          { upsert: true, session },
        );
    }
    await db
      .collection("products")
      .updateOne(
        { _id: row._id },
        { $set: { excerpt, ingredients, updatedAt: now }, $inc: { __v: 1 } },
        { session },
      );
  }
}
