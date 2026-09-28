import { expect, test } from "@playwright/test";
test("inventory refuses forged owner and cross-origin decisions", async ({ request }) => {
  expect(
    (await request.get("/api/inventory", { headers: { "X-Admin-Role": "OWNER" } })).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/inventory/requests/000000000000000000000001/decision", {
        data: { decision: "approved" },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
});
