import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";

type MediaIdentity = { logoMediaId: string | null; faviconMediaId: string | null };
const businessEntityId = new Types.ObjectId("0000000000000000000000b1");

/** Maintains the singleton's usage references in the same settings transaction. */
export async function syncSettingsMediaReferences(
  connection: Connection,
  session: ClientSession,
  previous: MediaIdentity,
  next: MediaIdentity,
  now = new Date(),
) {
  if (previous.logoMediaId === next.logoMediaId && previous.faviconMediaId === next.faviconMediaId)
    return;
  const assets = connection.db!.collection("media_assets");
  const ids = [
    ...new Set(
      [previous.logoMediaId, previous.faviconMediaId, next.logoMediaId, next.faviconMediaId].filter(
        (id): id is string => !!id,
      ),
    ),
  ].sort();
  for (const id of ids) {
    const row = await assets.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $inc: { referenceGuard: 1 } },
      { session, returnDocument: "after", projection: { status: 1, visibility: 1, deletedAt: 1 } },
    );
    if (!row) throw new ApplicationError("NOT_FOUND", "Business media does not exist");
    if (
      [next.logoMediaId, next.faviconMediaId].includes(id) &&
      (row.status !== "ready" || row.visibility !== "public" || row.deletedAt)
    )
      throw new ApplicationError("CONFLICT", "Business image must be ready and public");
  }
  const references = connection.db!.collection("media_references");
  await references.deleteMany({ entityKind: "settings", entityId: businessEntityId }, { session });
  for (const field of ["logoMediaId", "faviconMediaId"] as const) {
    const id = next[field];
    if (id)
      await references.insertOne(
        {
          mediaId: new Types.ObjectId(id),
          entityKind: "settings",
          entityId: businessEntityId,
          field,
          createdAt: now,
          updatedAt: now,
          __v: 0,
        },
        { session },
      );
  }
}
