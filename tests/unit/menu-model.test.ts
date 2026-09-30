import { expect, test } from "vitest";

import type { MenuCategory } from "../../src/modules/catalog/products/contracts/menu.ts";
import { categoryAnchor, menuCards } from "../../src/storefront/menu-model.ts";

test("menu projection omits internal and addition details from the rendered list", () => {
  const category: MenuCategory = {
    id: "a".repeat(24),
    name: "قهوه گرم",
    sortOrder: 0,
    products: [
      {
        id: "b".repeat(24),
        name: "اسپرسو",
        slug: "espresso",
        excerpt: "تازه",
        ingredients: "",
        basePriceToman: 95000,
        mediaIds: ["c".repeat(24)],
        orderable: true,
        soldCount: 12,
        additions: [
          {
            id: "d".repeat(24),
            name: "شات",
            priceToman: 30000,
            available: true,
            mediaId: null,
            sortOrder: 0,
          },
        ],
      },
    ],
  };
  const projection = menuCards([category]);
  expect(projection[0].products[0]).toMatchObject({
    name: "اسپرسو",
    imageId: "c".repeat(24),
    hasAdditions: true,
  });
  const htmlData = JSON.stringify(projection);
  expect(htmlData).not.toContain("soldCount");
  expect(htmlData).not.toContain("30000");
  expect(htmlData).not.toContain("espresso");
  expect(categoryAnchor(category.id)).toBe(`category-${category.id}`);
});

test("maximum supported catalog has a bounded lean menu projection", () => {
  const products = Array.from({ length: 500 }, (_, index) => ({
    id: index.toString(16).padStart(24, "0"),
    name: `قهوه ${index}`,
    slug: `q-${index}`,
    excerpt: "عطر دلپذیر قهوه",
    ingredients: "",
    basePriceToman: 99000,
    mediaIds: [],
    orderable: true,
    soldCount: 0,
    additions: [],
  }));
  const cards = menuCards([{ id: "f".repeat(24), name: "قهوه", sortOrder: 0, products }]);
  expect(cards[0].products).toHaveLength(500);
  expect(Buffer.byteLength(JSON.stringify(cards))).toBeLessThan(110_000);
});
