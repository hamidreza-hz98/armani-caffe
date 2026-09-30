import { expect, test } from "@playwright/test";

test("dashboard analytics never trusts a forged owner header", async ({ request }) => {
  const response = await request.get("/api/admin/analytics/dashboard", {
    headers: { "x-admin-role": "OWNER", "x-admin-id": "0123456789abcdef01234567" },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
});
