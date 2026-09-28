import "server-only";

import type { ClientSession, Connection } from "mongoose";
import { Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";

/** Called only inside the category write transaction. Asset guard locks race with delete. */
export async function syncCategoryMediaReference(
  connection: Connection,
  session: ClientSession,
  categoryId: string,
  oldMediaId: string | null,
  nextMediaId: string | null,
  now: Date = new Date(),
) {
  if (oldMediaId === nextMediaId) return;
  const assets = connection.db!.collection("media_assets");
  for (const id of [
    ...new Set([oldMediaId, nextMediaId].filter((value): value is string => !!value)),
  ].sort()) {
    const row = await assets.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $inc: { referenceGuard: 1 } },
      { session, returnDocument: "after", projection: { status: 1, visibility: 1, deletedAt: 1 } },
    );
    if (!row) throw new ApplicationError("NOT_FOUND", "Referenced media does not exist");
    if (
      id === nextMediaId &&
      (row.status !== "ready" || row.visibility !== "public" || row.deletedAt)
    )
      throw new ApplicationError("CONFLICT", "Category image must be ready and public");
  }
  const references = connection.db!.collection("media_references");
  await references.deleteMany(
    { entityKind: "category", entityId: new Types.ObjectId(categoryId), field: "mediaId" },
    { session },
  );
  if (nextMediaId)
    await references.insertOne(
      {
        mediaId: new Types.ObjectId(nextMediaId),
        entityKind: "category",
        entityId: new Types.ObjectId(categoryId),
        field: "mediaId",
        createdAt: now,
        updatedAt: now,
        __v: 0,
      },
      { session },
    );
}
