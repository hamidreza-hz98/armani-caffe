import { expect, test } from "../fixtures/playwright.ts";

test("admin login is Persian and protected dashboard redirects without a session", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "ورود مدیر" })).toBeVisible();
  await expect(page.getByLabel("نام کاربری")).toBeVisible();
  await expect(page.getByLabel("رمز عبور")).toHaveAttribute("type", "password");
});

test("forged role headers do not authorize admin routes; cross-origin login is blocked", async ({
  request,
}) => {
  const forged = await request.get("/api/admins", {
    headers: { "X-Admin-Role": "OWNER", "X-Admin-ID": "000000000000000000000001" },
  });
  expect(forged.status()).toBe(401);
  const crossOrigin = await request.post("/api/admin/auth/login", {
    headers: { Origin: "https://evil.invalid" },
    data: { username: "owner", password: "some-password-123456" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(crossOrigin.headers()["set-cookie"]).toBeUndefined();
  expect(crossOrigin.headers()["cache-control"]).toBe("no-store");
});
