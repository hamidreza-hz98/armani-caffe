import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";
export async function productMediaUsages(
  connection: Connection,
  session: ClientSession | null,
  mediaId: string,
) {
  const rows = await connection
    .db!.collection("products")
    .find(
      { mediaIds: new Types.ObjectId(mediaId) },
      { session: session ?? undefined, projection: { _id: 1 } },
    )
    .maxTimeMS(2500)
    .toArray();
  const additions = await connection
    .db!.collection("product_additions")
    .find(
      { mediaId: new Types.ObjectId(mediaId) },
      { session: session ?? undefined, projection: { productId: 1 } },
    )
    .maxTimeMS(2500)
    .toArray();
  return [
    ...rows.map((r) => ({
      entityKind: "product" as const,
      entityId: String(r._id),
      field: "mediaIds" as const,
    })),
    ...[...new Set(additions.map((r) => String(r.productId)))].map((productId) => ({
      entityKind: "product" as const,
      entityId: productId,
      field: "additionMediaIds" as const,
    })),
  ];
}
export async function productMediaIds(
  connection: Connection,
  session: ClientSession,
  productId: string,
) {
  const row = await connection
    .db!.collection<{ _id: Types.ObjectId; mediaIds: Types.ObjectId[] }>("products")
    .findOne({ _id: new Types.ObjectId(productId) }, { session, projection: { mediaIds: 1 } });
  return row?.mediaIds.map(String) ?? [];
}
export async function replaceProductMedia(
  connection: Connection,
  session: ClientSession,
  from: string,
  to: string,
) {
  const fromId = new Types.ObjectId(from),
    toId = new Types.ObjectId(to);
  const additions = await connection
    .db!.collection("product_additions")
    .find({ mediaId: fromId }, { session })
    .toArray();
  const rows = await connection
    .db!.collection<{ _id: Types.ObjectId; mediaIds: Types.ObjectId[] }>("products")
    .find(
      { $or: [{ mediaIds: fromId }, { _id: { $in: additions.map((a) => a.productId) } }] },
      { session },
    )
    .sort({ _id: 1 })
    .toArray();
  for (const row of rows)
    await connection.db!.collection("products").updateOne(
      { _id: row._id },
      {
        $set: {
          mediaIds: [
            ...new Set(row.mediaIds.map((id) => (String(id) === from ? to : String(id)))),
          ].map((id) => new Types.ObjectId(id)),
          updatedAt: new Date(),
        },
        $inc: { __v: 1 },
      },
      { session },
    );
  await connection
    .db!.collection("product_additions")
    .updateMany(
      { mediaId: fromId },
      { $set: { mediaId: toId, updatedAt: new Date() }, $inc: { __v: 1 } },
      { session },
    );
}
