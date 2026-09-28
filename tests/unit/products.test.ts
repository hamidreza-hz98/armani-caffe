import { expect, test } from "vitest";

import { parseProduct } from "@/modules/catalog/products/contracts/product";
import {
  assertProductTransition,
  validatePublished,
} from "@/modules/catalog/products/domain/lifecycle";
test("product contracts reject internal fields, fractional money and duplicate additions", () => {
  const raw = { name: "قهوه", categoryId: "000000000000000000000001" };
  expect(parseProduct(raw).basePriceToman).toBe(0);
  expect(() => parseProduct({ ...raw, soldCount: 100 })).toThrow();
  expect(() => parseProduct({ ...raw, basePriceToman: 1.5 })).toThrow();
  expect(() =>
    parseProduct({
      ...raw,
      additions: [
        { name: "شیر", priceToman: 1 },
        { name: "شیر", priceToman: 2 },
      ],
    }),
  ).toThrow();
  expect(() => parseProduct({ revision: 0 }, true)).toThrow();
});
test("product transitions and publication requirements are explicit", () => {
  assertProductTransition("draft", "published");
  assertProductTransition("published", "draft");
  assertProductTransition("published", "archived");
  expect(() => assertProductTransition("archived", "published")).toThrow();
  expect(() =>
    validatePublished({ name: "قهوه", excerpt: "", mediaIds: [], basePriceToman: 0 }),
  ).toThrow();
});
