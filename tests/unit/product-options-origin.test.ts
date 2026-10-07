import { expect, test } from "vitest";

import { isAllowedQuoteOrigin } from "@/server/catalog/product-options";

const appUrl = "https://cafe-armani.ir";
const adminUrl = "https://admin.cafe-armani.ir";
const request = (origin?: string) =>
  new Request("http://internal-next:3000/api/products/123/options", {
    method: "POST",
    headers: origin ? { origin } : {},
  });

test("allows the configured storefront origin through a reverse proxy", () => {
  expect(isAllowedQuoteOrigin(request(appUrl), appUrl, adminUrl)).toBe(true);
  expect(isAllowedQuoteOrigin(request(adminUrl), appUrl, adminUrl)).toBe(true);
  expect(isAllowedQuoteOrigin(request("http://internal-next:3000"), appUrl, adminUrl)).toBe(true);
});

test("rejects missing and unrelated quote origins", () => {
  expect(isAllowedQuoteOrigin(request(), appUrl, adminUrl)).toBe(false);
  expect(isAllowedQuoteOrigin(request("https://example.com"), appUrl, adminUrl)).toBe(false);
});
