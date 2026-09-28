import { expect, test } from "../fixtures/playwright.ts";

test("settings reads and writes fail closed despite forged owner identity", async ({ request }) => {
  const headers = {
    Origin: "http://localhost:3000",
    "Idempotency-Key": "forged-settings-owner",
    "X-Admin-Role": "OWNER",
    "X-Admin-ID": "000000000000000000000001",
  };
  const read = await request.get("/api/settings/payment", { headers });
  expect(read.status()).toBe(401);
  const update = await request.patch("/api/settings/payment", {
    headers,
    data: {
      revision: 0,
      values: {},
      secrets: { gatewayCredential: "must-not-appear-in-response" },
    },
  });
  expect(update.status()).toBe(401);
  const payload = await update.json();
  expect(payload).toMatchObject({
    ok: false,
    error: { code: "UNAUTHORIZED", message: "برای ادامه وارد حساب خود شوید." },
  });
  expect(JSON.stringify(payload)).not.toContain("must-not-appear-in-response");
  expect(update.headers()["cache-control"]).toBe("no-store");
  expect(update.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
});

test("settings reject unexpected query parameters before opening downstream connections", async ({
  request,
}) => {
  const response = await request.get("/api/settings/public?secrets=true");
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
});
