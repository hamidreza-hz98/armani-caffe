import "server-only";

import { Types } from "mongoose";

import { dashboardAdminToken, requireDashboardActor } from "@/dashboard/server";
import { configuredInventoryService } from "@/modules/inventory/server";
import { getDatabaseConnection } from "@/server/database/connection";
import { requireAdminCapability } from "@/shared/admin-capabilities";

import type {
  InventoryItem,
  InventorySnapshot,
  StockMapping,
  StockMovement,
  StockRequest,
} from "./model";

export async function inventorySnapshot(token: string | null): Promise<InventorySnapshot> {
  const connection = await getDatabaseConnection();
  const { service } = await configuredInventoryService();
  // Service methods authorize inventory.read before this dashboard-specific projection runs.
  const [items, requests] = await Promise.all([
    service.list(token) as Promise<InventoryItem[]>,
    service.requests(token) as Promise<StockRequest[]>,
  ]);
  const ids = items.map((item) => new Types.ObjectId(item.id));
  const rules = ids.length
    ? await connection
        .db!.collection<{
          inventoryItemId: Types.ObjectId;
          productId: Types.ObjectId;
          quantityPerUnit: number;
        }>("product_consumption_rules")
        .find(
          { inventoryItemId: { $in: ids }, active: true },
          { projection: { inventoryItemId: 1, productId: 1, quantityPerUnit: 1 } },
        )
        .limit(501)
        .maxTimeMS(2500)
        .toArray()
    : [];
  const productIds = [...new Set(rules.map((row) => String(row.productId)))].map(
    (id) => new Types.ObjectId(id),
  );
  const products = productIds.length
    ? await connection
        .db!.collection<{ _id: Types.ObjectId; name: string }>("products")
        .find({ _id: { $in: productIds } }, { projection: { name: 1 } })
        .limit(500)
        .maxTimeMS(2500)
        .toArray()
    : [];
  const names = new Map(products.map((row) => [String(row._id), row.name]));
  const actorIds = [
    ...new Set(
      requests.flatMap((row) => [row.requestedBy, row.decidedBy].filter(Boolean) as string[]),
    ),
  ]
    .filter((id) => /^[a-f\d]{24}$/u.test(id))
    .map((id) => new Types.ObjectId(id));
  const admins = actorIds.length
    ? await connection
        .db!.collection<{ _id: Types.ObjectId; displayName: string }>("admins")
        .find({ _id: { $in: actorIds } }, { projection: { displayName: 1 } })
        .limit(200)
        .maxTimeMS(2500)
        .toArray()
    : [];
  return {
    items,
    requests,
    mappings: rules.slice(0, 500).map((rule): StockMapping => ({
      itemId: String(rule.inventoryItemId),
      productId: String(rule.productId),
      productName: names.get(String(rule.productId)) ?? "محصول حذف‌شده",
      quantityPerUnit: rule.quantityPerUnit,
    })),
    actors: Object.fromEntries(admins.map((admin) => [String(admin._id), admin.displayName])),
    truncated: items.length === 200 || requests.length === 200 || rules.length > 500,
  };
}

export async function inventoryPageData() {
  const actor = requireAdminCapability(await requireDashboardActor(), "inventory.read");
  return { actor, snapshot: await inventorySnapshot(await dashboardAdminToken()) };
}

export async function inventoryItemMovements(token: string | null, id: string) {
  const { service } = await configuredInventoryService();
  return service.movements(token, id) as Promise<StockMovement[]>;
}
