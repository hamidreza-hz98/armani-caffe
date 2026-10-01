import { expect, test } from "vitest";

import type { MenuProduct } from "@/modules/catalog/products";
import { quoteProduct } from "@/storefront/product-quote";

const product: MenuProduct = {
  id: "a".repeat(24),
  name: "آمریکانو",
  slug: "americano",
  excerpt: "",
  ingredients: "",
  basePriceToman: 100000,
  mediaIds: [],
  orderable: true,
  soldCount: 0,
  additions: [
    {
      id: "b".repeat(24),
      name: "شات",
      priceToman: 30000,
      available: true,
      mediaId: null,
      sortOrder: 0,
    },
    {
      id: "c".repeat(24),
      name: "شیر",
      priceToman: 20000,
      available: false,
      mediaId: null,
      sortOrder: 1,
    },
  ],
};

test("server quote uses current ordered additions and integer toman", () => {
  expect(quoteProduct(product, { additionIds: ["b".repeat(24)], quantity: 2 })).toMatchObject({
    unitPriceToman: 130000,
    totalToman: 260000,
  });
});

test("server quote rejects duplicate, unavailable and out-of-range selections", () => {
  expect(() =>
    quoteProduct(product, { additionIds: ["b".repeat(24), "b".repeat(24)], quantity: 1 }),
  ).toThrow();
  expect(() => quoteProduct(product, { additionIds: ["c".repeat(24)], quantity: 1 })).toThrow();
  expect(() => quoteProduct(product, { additionIds: [], quantity: 101 })).toThrow();
  expect(() =>
    quoteProduct({ ...product, orderable: false }, { additionIds: [], quantity: 1 }),
  ).toThrow();
});
