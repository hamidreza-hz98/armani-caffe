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
