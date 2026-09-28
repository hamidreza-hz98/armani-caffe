import { expect, test } from "vitest";

import { baseQuantity, stockStatus } from "@/modules/inventory";
import { parseStockRequest } from "@/modules/inventory/contracts/stock";

test("exact quantities use fixed compatible unit families", () => {
  expect(baseQuantity("1.125", "kilogram", "gram")).toBe(1125);
  expect(baseQuantity("-0.001", "liter", "milliliter")).toBe(-1);
  expect(baseQuantity(3, "piece", "piece")).toBe(3);
  for (const [quantity, unit, target] of [
    ["0.1", "piece", "piece"],
    ["1", "liter", "gram"],
    ["1", "ounce", "gram"],
    ["900719925474099", "kilogram", "gram"],
  ] as const)
    expect(() => baseQuantity(quantity, unit, target)).toThrow();
  expect(stockStatus(0, 0)).toBe("out");
  expect(stockStatus(50, 50)).toBe("low");
  expect(stockStatus(51, 50)).toBe("available");
});
test("stock contracts reject arbitrary mutations and forged reversal delta", () => {
  const values = {
    inventoryItemId: "000000000000000000000001",
    kind: "reversal",
    reversalOf: "000000000000000000000002",
    reason: "برگشت",
    idempotencyKey: "reverse-0001",
  };
  expect(parseStockRequest(values).quantity).toBeUndefined();
  expect(() => parseStockRequest({ ...values, quantity: 100 })).toThrow();
  expect(() => parseStockRequest({ ...values, decidedBy: values.inventoryItemId })).toThrow();
});
