import { asToman } from "../../../shared/domain.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { OrderItemSnapshot, OrderStatus } from "./model.ts";
export type StockLine = {
  inventoryItemId: string;
  quantity: number;
  unit: "gram" | "milliliter" | "piece";
};
export type CustomerSnapshot = { id: string; displayName: string | null; phone: string };
export type PricingSnapshot = {
  subtotalToman: number;
  discountToman: 0;
  deliveryToman: 0;
  totalToman: number;
};
export type CheckoutState =
  "PAYMENT_PENDING" | "RECOVERY_REQUIRED" | "CONFIRMED" | "REFUND_REQUESTED" | "REFUNDED";
export type CheckoutView = {
  id: string;
  cartId: string;
  state: CheckoutState;
  totalToman: number;
  recovery: "INSUFFICIENT_STOCK" | "CART_UNAVAILABLE" | null;
  orderId: string | null;
  revision: number;
};
export type OrderView = {
  id: string;
  code: string;
  customer: CustomerSnapshot;
  items: OrderItemSnapshot[];
  pricing: PricingSnapshot;
  transaction: { id: string; provider: string; reference: string };
  notes: string;
  tableNumber?: number | null;
  status: OrderStatus;
  paymentStatus: "paid" | "refunded";
  refundStatus: "NONE" | "REQUESTED" | "REFUNDED";
  revision: number;
  placedAt: string;
};
export function orderCode(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new RangeError("Invalid order code sequence");
  return `AC-${String(sequence).padStart(7, "0")}`;
}
export function assertPricing(items: readonly OrderItemSnapshot[], pricing: PricingSnapshot) {
  const total = asToman(items.reduce((sum, i) => sum + asToman(i.lineTotalToman), 0));
  if (
    !items.length ||
    !total ||
    pricing.subtotalToman !== total ||
    pricing.totalToman !== total ||
    pricing.discountToman !== 0 ||
    pricing.deliveryToman !== 0 ||
    items.some((i) => i.lineTotalToman !== i.unitPriceToman * i.quantity)
  )
    throw new ApplicationError("VALIDATION", "Order pricing snapshot is inconsistent");
}
