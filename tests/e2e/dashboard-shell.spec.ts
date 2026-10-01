import { expect, test } from "../fixtures/playwright.ts";

test("protected dashboard redirects to login with a safe destination and noindex", async ({
  page,
}) => {
  await page.goto("/dashboard/orders");
  await expect(page).toHaveURL(/\/dashboard\/login\?next=%2Fdashboard%2Forders$/u);
  await expect(page.getByRole("heading", { name: "ورود به پنل مدیریت" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
  await page.goto("/dashboard/login?next=https%3A%2F%2Fevil.example");
  await expect(page.getByRole("heading", { name: "ورود به پنل مدیریت" })).toBeVisible();
  await expect(page.locator("#admin-password")).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "نمایش رمز عبور" }).click();
  await expect(page.locator("#admin-password")).toHaveAttribute("type", "text");
});

for (const viewport of [
  { width: 1440, height: 1024 },
  { width: 390, height: 844 },
] as const) {
  test(`login is usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard/login");
    await expect(page.getByLabel("نام کاربری")).toBeVisible();
    await expect(page.locator("#admin-password")).toBeVisible();
    await expect(page.getByRole("button", { name: "ورود به داشبورد مدیریت" })).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(viewport.width);
  });
}
