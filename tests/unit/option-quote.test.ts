import { expect, test } from "vitest";

import { quoteSelectedOptions } from "@/storefront/option-quote";

const options = {
  id: "a".repeat(24),
  basePriceToman: 100_000,
  additions: [
    { id: "b".repeat(24), priceToman: 30_000, available: true },
    { id: "c".repeat(24), priceToman: 20_000, available: false },
  ],
};

test("calculates a display quote from fetched product options", () => {
  expect(quoteSelectedOptions(options, ["b".repeat(24)], 2)).toEqual({
    productId: options.id,
    additionIds: ["b".repeat(24)],
    quantity: 2,
    unitPriceToman: 130_000,
    totalToman: 260_000,
  });
});

test("does not quote missing, unavailable, or invalid additions", () => {
  expect(quoteSelectedOptions(options, ["c".repeat(24)], 1)).toBeNull();
  expect(quoteSelectedOptions(options, ["d".repeat(24)], 1)).toBeNull();
  expect(quoteSelectedOptions(options, ["b".repeat(24), "b".repeat(24)], 1)).toBeNull();
  expect(quoteSelectedOptions(options, [], 101)).toBeNull();
});
