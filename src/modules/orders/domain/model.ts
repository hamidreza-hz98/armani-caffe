import {
  asToman,
  type EntityDto,
  type TomanAmount,
  type UtcTimestamp,
} from "../../../shared/domain.ts";

export type OrderStatus = "NEW" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
export type OrderPaymentStatus = "unpaid" | "pending" | "paid" | "refunded";
export type OrderAdditionSnapshot = Readonly<{
  additionId: string;
  name: string;
  priceToman: TomanAmount;
}>;
export type OrderItemSnapshot = Readonly<{
  productId: string;
  productName: string;
  categoryName: string;
  additions: readonly OrderAdditionSnapshot[];
  quantity: number;
  note: string;
  unitPriceToman: TomanAmount;
  lineTotalToman: TomanAmount;
}>;
export type Order = EntityDto &
  Readonly<{
    code: string;
    snapshotVersion: 1;
    customerId: string | null;
    items: readonly OrderItemSnapshot[];
    totalToman: TomanAmount;
    tableNumber?: number | null;
    status: OrderStatus;
    paymentStatus: OrderPaymentStatus;
    idempotencyKey: string;
    placedAt: UtcTimestamp;
  }>;

const allowed: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid order transition: ${from} -> ${to}`);
}

const paymentAllowed: Record<OrderPaymentStatus, readonly OrderPaymentStatus[]> = {
  unpaid: ["pending", "paid"],
  pending: ["unpaid", "paid"],
  paid: ["refunded"],
  refunded: [],
};
export function assertOrderPaymentTransition(
  from: OrderPaymentStatus,
  to: OrderPaymentStatus,
): void {
  if (!paymentAllowed[from].includes(to)) {
    throw new RangeError(`Invalid order payment transition: ${from} -> ${to}`);
  }
}

export function makeOrderItemSnapshot(input: {
  productId: string;
  productName: string;
  categoryName: string;
  additions: readonly { additionId: string; name: string; priceToman: number }[];
  quantity: number;
  note?: string;
  basePriceToman: number;
}): OrderItemSnapshot {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100)
    throw new RangeError("Invalid order item quantity");
  if (new Set(input.additions.map((a) => a.additionId)).size !== input.additions.length)
    throw new RangeError("Duplicate order additions");
  const additions = Object.freeze(
    input.additions.map((addition) =>
      Object.freeze({
        additionId: addition.additionId,
        name: addition.name,
        priceToman: asToman(addition.priceToman),
      }),
    ),
  );
  const unitPriceToman = asToman(
    asToman(input.basePriceToman) +
      additions.reduce((sum, addition) => sum + addition.priceToman, 0),
  );
  return Object.freeze({
    productId: input.productId,
    productName: input.productName,
    categoryName: input.categoryName,
    additions,
    quantity: input.quantity,
    note: input.note ?? "",
    unitPriceToman,
    lineTotalToman: asToman(unitPriceToman * input.quantity),
  });
}
