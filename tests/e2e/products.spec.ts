import { expect, test } from "@playwright/test";
test("product mutations reject forged role and invalid origin", async ({ request }) => {
  expect(
    (await request.get("/api/products", { headers: { "X-Admin-Role": "OWNER" } })).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/products/000000000000000000000001/publish", {
        data: { revision: 0 },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
});
