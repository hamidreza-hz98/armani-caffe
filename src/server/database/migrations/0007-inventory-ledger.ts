import "server-only";

import type { ClientSession, Connection } from "mongoose";
export const version = 7;
export const description = "Verify stock ledger reconciliation before enabling approvals";
export async function up(db: NonNullable<Connection["db"]>, session: ClientSession) {
  const requests = await db.collection("stock_approval_requests").find({}, { session }).toArray();
  if (requests.some((row) => !row.kind || !row.fingerprint || !row.idempotencyKey))
    throw new Error(
      "Legacy stock approvals require operator review; no decisions will be inferred",
    );
  const movements = await db.collection("inventory_movements").find({}, { session }).toArray();
  if (
    movements.some(
      (row) =>
        !row.unit ||
        !row.fingerprint ||
        !Number.isSafeInteger(row.before) ||
        !Number.isSafeInteger(row.after) ||
        row.after !== row.before + row.delta,
    )
  )
    throw new Error(
      "Legacy stock movements require operator review and explicit ledger reconciliation",
    );
  for (const item of await db.collection("inventory_items").find({}, { session }).toArray()) {
    const total = movements
      .filter((row) => String(row.inventoryItemId) === String(item._id))
      .reduce((sum, row) => sum + row.delta, 0);
    if (!Number.isSafeInteger(total) || total !== item.onHand)
      throw new Error("Inventory balance does not match ledger; operator review required");
  }
}
