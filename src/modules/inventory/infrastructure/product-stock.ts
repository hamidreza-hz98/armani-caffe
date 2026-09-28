import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";
export async function productStockProjection(
  connection: Connection,
  session: ClientSession,
  ids: string[],
) {
  const rules = await connection
    .db!.collection("product_consumption_rules")
    .find(
      { productId: { $in: ids.map((id) => new Types.ObjectId(id)) }, active: true },
      { session },
    )
    .maxTimeMS(2500)
    .toArray();
  const items = await connection
    .db!.collection("inventory_items")
    .find(
      { _id: { $in: rules.map((r) => r.inventoryItemId) } },
      { session, projection: { unit: 1, onHand: 1, status: 1 } },
    )
    .maxTimeMS(2500)
    .toArray();
  const byItem = new Map(items.map((item) => [String(item._id), item]));
  const byProduct = new Map<string, typeof rules>();
  for (const rule of rules) {
    const key = String(rule.productId);
    const group = byProduct.get(key) ?? [];
    group.push(rule);
    byProduct.set(key, group);
  }
  return new Map(
    ids.map((id) => {
      const mapped = byProduct.get(id) ?? [];
      const valid = mapped.every((r) => {
        const item = byItem.get(String(r.inventoryItemId));
        return (
          item?.status === "active" &&
          ["gram", "milliliter", "piece"].includes(item.unit) &&
          Number.isSafeInteger(item.onHand) &&
          item.onHand >= 0 &&
          Number.isSafeInteger(r.quantityPerUnit) &&
          r.quantityPerUnit > 0
        );
      });
      return [
        id,
        {
          valid,
          orderable:
            valid &&
            mapped.every((r) => byItem.get(String(r.inventoryItemId))!.onHand >= r.quantityPerUnit),
          rules: mapped.map((r) => ({
            inventoryItemId: String(r.inventoryItemId),
            quantity: Number(r.quantityPerUnit),
            unit: String(byItem.get(String(r.inventoryItemId))?.unit ?? "invalid"),
          })),
        },
      ] as const;
    }),
  );
}
