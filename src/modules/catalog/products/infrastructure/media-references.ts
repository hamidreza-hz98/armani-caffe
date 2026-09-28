import "server-only";

import type { ClientSession, Connection, Model } from "mongoose";
import { Types } from "mongoose";

import { productSchema } from "./schema.ts";

type ProductMediaRecord = { _id: Types.ObjectId; mediaIds: Types.ObjectId[]; __v: number };
function products(connection: Connection) {
  return (
    (connection.models.Product as Model<ProductMediaRecord>) ??
    connection.model<ProductMediaRecord>("Product", productSchema)
  );
}
export async function productMediaUsages(
  connection: Connection,
  session: ClientSession | null,
  mediaId: string,
) {
  const rows = await products(connection)
    .find({ mediaIds: mediaId })
    .session(session)
    .select("_id")
    .maxTimeMS(2500)
    .lean();
  return rows.map((row) => ({
    entityKind: "product" as const,
    entityId: String(row._id),
    field: "mediaIds" as const,
  }));
}
export async function productMediaIds(
  connection: Connection,
  session: ClientSession,
  productId: string,
) {
  const row = await products(connection)
    .findById(productId)
    .session(session)
    .select("mediaIds")
    .lean();
  return row?.mediaIds.map(String) ?? [];
}
export async function replaceProductMedia(
  connection: Connection,
  session: ClientSession,
  from: string,
  to: string,
) {
  const rows = await products(connection).find({ mediaIds: from }).session(session);
  for (const row of rows) {
    row.mediaIds = [
      ...new Set(row.mediaIds.map((id) => (String(id) === from ? to : String(id)))),
    ].map((id) => new Types.ObjectId(id));
    await row.save({ session });
  }
}
