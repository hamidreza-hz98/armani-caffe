import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
export async function syncProductMediaReferences(
  connection: Connection,
  session: ClientSession,
  productId: string,
  old: string[],
  next: string[],
  oldAdditions: string[],
  nextAdditions: string[],
  now: Date,
) {
  if (!session.inTransaction())
    throw new ApplicationError("VALIDATION", "Product media needs an active transaction");
  for (const id of [...new Set([...old, ...next, ...oldAdditions, ...nextAdditions])].sort()) {
    const asset = await connection.db!.collection("media_assets").findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $inc: { referenceGuard: 1 } },
      {
        session,
        returnDocument: "after",
        projection: { status: 1, visibility: 1, deletedAt: 1 },
      },
    );
    if (
      !asset ||
      ((next.includes(id) || nextAdditions.includes(id)) &&
        (asset.status !== "ready" || asset.visibility !== "public" || asset.deletedAt))
    )
      throw new ApplicationError(
        "CONFLICT",
        "Product and addition images must be ready public assets",
      );
  }
  const refs = connection.db!.collection("media_references");
  await refs.deleteMany(
    {
      entityKind: "product",
      entityId: new Types.ObjectId(productId),
      field: { $in: ["mediaIds", "additionMediaIds"] },
    },
    { session },
  );
  const rows = (
    [
      ["mediaIds", next],
      ["additionMediaIds", nextAdditions],
    ] as const
  ).flatMap(([field, ids]) =>
    [...new Set(ids)].map((id) => ({
      mediaId: new Types.ObjectId(id),
      entityKind: "product",
      entityId: new Types.ObjectId(productId),
      field,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    })),
  );
  if (rows.length) await refs.insertMany(rows, { session, ordered: true });
}
