import { expect, test } from "@playwright/test";
test("cart routes reject forged customers and cross-origin mutations before database access", async ({
  request,
}) => {
  const response = await request.get("/api/customer/cart", {
    headers: { "X-Customer-ID": "000000000000000000000001" },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(
    (
      await request.post("/api/customer/cart", {
        headers: { Origin: "https://evil.example" },
        data: { operation: "notes", revision: 0, notes: "test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/customer/cart/preview", {
        headers: { Origin: "https://evil.example" },
        data: { revision: 0 },
      })
    ).status(),
  ).toBe(403);
});
