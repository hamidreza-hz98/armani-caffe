import { test as baseTest } from "@playwright/test";

import { expect, test } from "../fixtures/playwright.ts";

test("liveness stays up while unavailable dependencies make readiness fail", async ({
  request,
}) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "alive" });
  expect(live.headers()["cache-control"]).toContain("no-store");
  expect(live.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);

  const ready = await request.get("/api/health/ready");
  expect(ready.status()).toBe(503);
  const payload = await ready.json();
  expect(payload.status).toBe("not_ready");
  expect(payload.checks).toEqual({ mongodb: "down", redis: "down", minio: "down" });
  expect(JSON.stringify(payload)).not.toContain("test_secret_key");
});

test("HTML and API responses carry baseline security headers", async ({ request }) => {
  for (const path of ["/", "/api/health/live"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  }
});

baseTest("not-found UI is Persian", async ({ page }) => {
  await page.goto("/not-an-actual-page");
  await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();
});
