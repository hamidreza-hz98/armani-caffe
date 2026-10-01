import { asToman } from "../../../shared/domain.ts";
import { cartItemKey, type CartItemSnapshot, makeCartItemSnapshot } from "./model.ts";

export type CatalogPrice = {
  id: string;
  name: string;
  basePriceToman: number;
  available: boolean;
  stock?: { inventoryItemId: string; quantityPerUnit: number; availableQuantity: number }[];
  additions: { id: string; name: string; priceToman: number; available: boolean }[];
};
export type CartIssue = {
  code:
    | "PRODUCT_UNAVAILABLE"
    | "ADDITION_UNAVAILABLE"
    | "PRICE_CHANGED"
    | "CART_EXPIRED"
    | "INSUFFICIENT_STOCK";
  itemKey?: string;
  additionId?: string;
  previousUnitPriceToman?: number;
  currentUnitPriceToman?: number;
};
export function priceCart(
  items: readonly CartItemSnapshot[],
  catalog: ReadonlyMap<string, CatalogPrice>,
) {
  const issues: CartIssue[] = [];
  const demand = new Map<string, number>();
  for (const item of items)
    for (const rule of catalog.get(item.productId)?.stock ?? []) {
      demand.set(
        rule.inventoryItemId,
        (demand.get(rule.inventoryItemId) ?? 0) + rule.quantityPerUnit * item.quantity,
      );
    }
  const priced = items.map((old) => {
    const itemKey = cartItemKey(
      old.productId,
      old.additions.map((a) => a.additionId),
    );
    const product = catalog.get(old.productId);
    if (!product?.available) issues.push({ code: "PRODUCT_UNAVAILABLE", itemKey });
    if (
      product?.stock?.some(
        (rule) =>
          !Number.isSafeInteger(demand.get(rule.inventoryItemId)) ||
          demand.get(rule.inventoryItemId)! > rule.availableQuantity,
      )
    )
      issues.push({ code: "INSUFFICIENT_STOCK", itemKey });
    const additions = old.additions.map((selected) => {
      const current = product?.additions.find((a) => a.id === selected.additionId);
      if (!current?.available)
        issues.push({ code: "ADDITION_UNAVAILABLE", itemKey, additionId: selected.additionId });
      return current
        ? { additionId: current.id, name: current.name, priceToman: current.priceToman }
        : selected;
    });
    if (!product) return old;
    const item = makeCartItemSnapshot({
      productId: product.id,
      productName: product.name,
      basePriceToman: product.basePriceToman,
      quantity: old.quantity,
      note: old.note ?? "",
      additions,
    });
    if (old.unitPriceToman !== item.unitPriceToman)
      issues.push({
        code: "PRICE_CHANGED",
        itemKey,
        previousUnitPriceToman: old.unitPriceToman,
        currentUnitPriceToman: item.unitPriceToman,
      });
    return item;
  });
  const subtotalToman = asToman(priced.reduce((sum, item) => sum + item.lineTotalToman, 0));
  return {
    items: priced,
    issues,
    pricing: {
      subtotalToman,
      discountToman: 0 as const,
      deliveryToman: 0 as const,
      totalToman: subtotalToman,
    },
    checkoutReady: priced.length > 0 && issues.length === 0,
  };
}
