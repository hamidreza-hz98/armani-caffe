import type { CartItemSnapshot } from "../domain/model.ts";
import type { CartIssue } from "../domain/pricing.ts";
/** Browser-safe response: no owner/session/stock records or persistence documents. */
export type CartView = {
  id: string;
  revision: number;
  items: readonly CartItemSnapshot[];
  notes: string;
  expiresAt: string;
  pricing: { subtotalToman: number; discountToman: 0; deliveryToman: 0; totalToman: number };
  issues: CartIssue[];
  checkoutReady: boolean;
  accepted: boolean;
};
