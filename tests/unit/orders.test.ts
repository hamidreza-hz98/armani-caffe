import { expect, test } from "vitest";

import { assertOrderTransition, makeOrderItemSnapshot } from "@/modules/orders";
import { checkoutCommand, transitionCommand } from "@/modules/orders/contracts/commands";
import { assertPricing, orderCode } from "@/modules/orders/domain/confirmation";
test("human codes are padded, expand safely, and reject invalid counters", () => {
  expect(orderCode(8932)).toBe("AC-0008932");
  expect(orderCode(10000000)).toBe("AC-10000000");
  for (const value of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])
    expect(() => orderCode(value)).toThrow();
});
test("snapshot totals are immutable integers with no invented discounts or duplicate additions", () => {
  const source = {
    productId: "p",
    productName: "لاته",
    categoryName: "قهوه",
    basePriceToman: 100000,
    quantity: 2,
    additions: [{ additionId: "a", name: "شیر", priceToman: 10000 }],
  };
  const item = makeOrderItemSnapshot(source);
  source.additions[0].priceToman = 1;
  expect(item.lineTotalToman).toBe(220000);
  expect(Object.isFrozen(item.additions[0])).toBe(true);
  const pricing = {
    subtotalToman: 220000,
    totalToman: 220000,
    discountToman: 0 as const,
    deliveryToman: 0 as const,
  };
  expect(() => assertPricing([item], pricing)).not.toThrow();
  expect(() => assertPricing([item], { ...pricing, totalToman: 1 })).toThrow();
  expect(() =>
    makeOrderItemSnapshot({ ...source, additions: [source.additions[0], source.additions[0]] }),
  ).toThrow();
});
test("status machine and strict commands reject skips, terminal writes, totals and revision forgery", () => {
  for (const [from, to] of [
    ["NEW", "PREPARING"],
    ["PREPARING", "READY"],
    ["READY", "COMPLETED"],
    ["NEW", "CANCELLED"],
  ] as const)
    expect(() => assertOrderTransition(from, to)).not.toThrow();
  expect(() => assertOrderTransition("NEW", "READY")).toThrow();
  expect(() => assertOrderTransition("COMPLETED", "CANCELLED")).toThrow();
  expect(() => transitionCommand({ status: "CANCELLED", revision: 0 })).toThrow();
  expect(() =>
    checkoutCommand({
      cartId: "1".repeat(24),
      revision: 0,
      idempotencyKey: "checkout-key",
      totalToman: 1,
    }),
  ).toThrow();
  expect(() =>
    checkoutCommand({ cartId: "1".repeat(24), revision: -1, idempotencyKey: "checkout-key" }),
  ).toThrow();
});
