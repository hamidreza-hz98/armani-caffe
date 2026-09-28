import { expect, test } from "@playwright/test";

test("category mutations reject forged roles and cross-origin requests", async ({ request }) => {
  const forged = await request.get("/api/categories", { headers: { "X-Admin-Role": "OWNER" } });
  expect(forged.status()).toBe(401);
  const crossOrigin = await request.post("/api/categories/reorder", {
    data: { revision: 0, ids: [] },
    headers: { Origin: "https://evil.example" },
  });
  expect(crossOrigin.status()).toBe(403);
});
