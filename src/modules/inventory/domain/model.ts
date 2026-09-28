import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

/** Quantities are non-negative integers in each item's declared base unit. */
export type InventoryItem = EntityDto &
  Readonly<{
    name: string;
    unit: "gram" | "milliliter" | "piece";
    onHand: number;
    reorderLevel: number;
    status: "active" | "archived";
    revision: number;
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
    reason: "initial" | "purchase" | "sale" | "waste" | "adjustment" | "refund" | "reversal";
    before: number;
    after: number;
    unit: "gram" | "milliliter" | "piece";
    reversalOf: string | null;
    requestId: string | null;
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
    kind: "initial" | "purchase" | "adjustment" | "waste" | "reversal";
    unit: "gram" | "milliliter" | "piece";
    movementId: string | null;
    reversalOf: string | null;
  }>;

export function assertStockApprovalTransition(
  from: StockApprovalRequest["status"],
  to: StockApprovalRequest["status"],
): void {
  if (from !== "pending" || (to !== "approved" && to !== "rejected"))
    throw new RangeError("Invalid stock approval transition");
}
