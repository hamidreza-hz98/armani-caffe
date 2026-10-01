import { expect, test } from "vitest";

import { parseProductListQuery } from "@/modules/catalog/products";

test("product list filters normalize shareable URL input and bound pagination", () => {
  expect(
    parseProductListQuery({
      q: "  قهوه  ",
      status: "published",
      available: "yes",
      sort: "price",
      page: "2",
    }),
  ).toMatchObject({ q: "قهوه", status: "published", available: "yes", sort: "price", page: 2 });
  expect(
    parseProductListQuery({ q: "<script>", status: "unknown", available: "maybe", page: "999" }),
  ).toMatchObject({ q: "script", status: "all", available: "all", page: 1 });
  expect(parseProductListQuery({ category: "not-an-id", page: "-1" })).toMatchObject({
    categoryId: "",
    page: 1,
  });
});
