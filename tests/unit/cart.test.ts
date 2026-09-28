import { expect, test } from "vitest";

import { parseCartMutation } from "@/modules/carts";
import { CartService } from "@/modules/carts/application/service";
import { makeCartItemSnapshot } from "@/modules/carts/domain/model";
import { priceCart } from "@/modules/carts/domain/pricing";
const productId = "000000000000000000000001",
  additionId = "000000000000000000000002",
  cartId = "000000000000000000000003";
const input = {
  operation: "add",
  cartId,
  revision: 0,
  productId,
  additionIds: [additionId],
  quantity: 2,
};
test("strict cart contracts reject prices, forged ownership, duplicates, and quantity overflow", () => {
  expect(parseCartMutation(input)).toEqual(input);
  for (const bad of [
    { totalToman: 1 },
    { customerId: productId },
    { quantity: 101 },
    { quantity: 0 },
    { quantity: 1.5 },
    { additionIds: [additionId, additionId] },
    { revision: -1 },
    { cartId: "" },
    { unitPriceToman: 0 },
  ])
    expect(() => parseCartMutation({ ...input, ...bad })).toThrow();
});
test("pricing refreshes server snapshots, detects changes, and reserves zero discount components", () => {
  const old = makeCartItemSnapshot({
    productId,
    productName: "قهوه",
    basePriceToman: 100,
    quantity: 2,
    additions: [{ additionId, name: "شیر", priceToman: 20 }],
  });
  const result = priceCart(
    [old],
    new Map([
      [
        productId,
        {
          id: productId,
          name: "قهوه جدید",
          basePriceToman: 150,
          available: true,
          additions: [{ id: additionId, name: "شیر", priceToman: 25, available: true }],
        },
      ],
    ]),
  );
  expect(result.pricing).toEqual({
    subtotalToman: 350,
    discountToman: 0,
    deliveryToman: 0,
    totalToman: 350,
  });
  expect(result.issues).toEqual([
    {
      code: "PRICE_CHANGED",
      itemKey: productId + ":" + additionId,
      previousUnitPriceToman: 120,
      currentUnitPriceToman: 175,
    },
  ]);
  expect(old.unitPriceToman).toBe(120);
  expect(result.checkoutReady).toBe(false);
});
test("missing products retain correction snapshots but cannot be checked out", () => {
  const item = makeCartItemSnapshot({
    productId,
    productName: "قهوه",
    basePriceToman: 100,
    quantity: 1,
    additions: [],
  });
  expect(priceCart([item], new Map())).toMatchObject({
    items: [item],
    issues: [{ code: "PRODUCT_UNAVAILABLE", itemKey: productId }],
    checkoutReady: false,
  });
});
test("preview accepts only a cart ID and revision, never caller-owned quotes", () => {
  const service = new CartService({
    execute: async () => {
      throw new Error("Should not be called");
    },
  });
  for (const bad of [
    { revision: 0 },
    { cartId, revision: 0, totalToman: 1 },
    { cartId, revision: -1 },
    { cartId: "forged", revision: 0 },
    null,
  ])
    expect(() => service.preview("token", bad)).toThrow();
});
