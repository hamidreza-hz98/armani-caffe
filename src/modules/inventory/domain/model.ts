import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

/** Quantities are non-negative integers in each item's declared base unit. */
export type InventoryItem = EntityDto &
  Readonly<{
    name: string;
    unit: "gram" | "milliliter" | "piece";
    onHand: number;
    reorderLevel: number;
    status: "active" | "archived";
  }>;
export type ProductConsumptionRule = EntityDto &
  Readonly<{
    productId: string;
    inventoryItemId: string;
    quantityPerUnit: number;
    active: boolean;
  }>;
export type InventoryMovement = EntityDto &
  Readonly<{
    inventoryItemId: string;
    delta: number;
    reason: "purchase" | "sale" | "waste" | "adjustment" | "refund";
    orderId: string | null;
    actorKind: "admin" | "system";
    actorId: string | null;
    idempotencyKey: string;
  }>;
export type StockApprovalRequest = EntityDto &
  Readonly<{
    inventoryItemId: string;
    requestedDelta: number;
    reason: string;
    requestedBy: string;
    decidedBy: string | null;
    decidedAt: UtcTimestamp | null;
    status: "pending" | "approved" | "rejected";
  }>;

export function assertStockApprovalTransition(
  from: StockApprovalRequest["status"],
  to: StockApprovalRequest["status"],
): void {
  if (from !== "pending" || (to !== "approved" && to !== "rejected"))
    throw new RangeError("Invalid stock approval transition");
}
