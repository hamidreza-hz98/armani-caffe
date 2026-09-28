import {
  asToman,
  type EntityDto,
  type TomanAmount,
  type UtcTimestamp,
} from "../../../shared/domain.ts";

export type CartAdditionSnapshot = Readonly<{
  additionId: string;
  name: string;
  priceToman: TomanAmount;
}>;
export const cartItemKey = (productId: string, additionIds: readonly string[]) =>
  [productId, ...[...additionIds].sort()].join(":");
export type CartItemSnapshot = Readonly<{
  productId: string;
  productName: string;
  additions: readonly CartAdditionSnapshot[];
  quantity: number;
  unitPriceToman: TomanAmount;
  lineTotalToman: TomanAmount;
}>;
export type Cart = EntityDto &
  Readonly<{
    customerId: string | null;
    sessionId: string | null;
    items: readonly CartItemSnapshot[];
    totalToman: TomanAmount;
    status: "active" | "payment_pending" | "checked_out" | "abandoned";
    expiresAt: UtcTimestamp | null;
  }>;

const allowed: Record<Cart["status"], readonly Cart["status"][]> = {
  active: ["payment_pending", "checked_out", "abandoned"],
  payment_pending: ["checked_out", "abandoned"],
  checked_out: [],
  abandoned: [],
};
export function assertCartTransition(from: Cart["status"], to: Cart["status"]): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid cart transition: ${from} -> ${to}`);
}

export function makeCartItemSnapshot(input: {
  productId: string;
  productName: string;
  quantity: number;
  basePriceToman: number;
  additions: readonly { additionId: string; name: string; priceToman: number }[];
}): CartItemSnapshot {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100)
    throw new RangeError("Invalid cart quantity");
  if (new Set(input.additions.map((a) => a.additionId)).size !== input.additions.length)
    throw new RangeError("Duplicate cart additions");
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
    additions,
    quantity: input.quantity,
    unitPriceToman,
    lineTotalToman: asToman(unitPriceToman * input.quantity),
  });
}
