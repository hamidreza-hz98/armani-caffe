import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:dashboard");
test.describe.configure({ mode: "default" });

const password = "dashboard-e2e-password-12345";
async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

test("owner sees management navigation, mobile drawer, profile and logout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page, "e2e-owner");
  await expect(page.getByRole("heading", { name: "نمای کلی" })).toBeVisible();
  await expect(page.getByRole("region", { name: "نیازمند اقدام" })).toBeVisible();
  await expect(page.getByRole("region", { name: "آمار فروش" })).toBeVisible();
  await expect(page.getByRole("link", { name: "۳۰ روز" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "۷ روز" }).click();
  await expect(page).toHaveURL(/\/dashboard\?range=7$/u);
  await expect(page.getByRole("heading", { name: "روند فروش ۷ روزه" })).toBeVisible();
  await expect(page.getByText("هنوز فروشی در این بازه ثبت نشده است.")).toBeVisible();
  await expect(
    page.locator("aside").getByRole("link", { name: "مدیران و دسترسی‌ها" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "باز کردن منوی مدیریت" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "ناوبری مدیریت" })
      .getByRole("link", { name: "مدیران و دسترسی‌ها" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "بستن منو" }).click();
  await page.getByRole("button", { name: /پروفایل/u }).click();
  await page.getByRole("button", { name: "خروج از حساب" }).click();
  await expect(page).toHaveURL(/\/dashboard\/login$/u);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/login\?next=%2Fdashboard$/u);
});

test("cashier cannot see or open owner-only management; order search navigates", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("WebSocket connection to");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "e2e-owner");
  const created = await page.evaluate(
    async (initialPassword) =>
      (
        await fetch("/api/admins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "e2e-cashier",
            displayName: "صندوقدار آزمایشی",
            phone: "09123456788",
            role: "CASHIER",
            password: initialPassword,
          }),
        })
      ).status,
    password,
  );
  expect(created).toBe(200);
  await page.context().clearCookies();
  await login(page, "e2e-cashier");
  await expect(page.getByRole("heading", { name: "نمای کلی" })).toBeVisible();
  await expect(page.getByRole("region", { name: "نیازمند اقدام" })).toBeVisible();
  await expect(page.getByRole("region", { name: "آمار فروش" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "بازه گزارش فروش" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "باز کردن منوی مدیریت" }).click();
  const nav = page.getByRole("navigation", { name: "ناوبری مدیریت" });
  await expect(nav.getByRole("link", { name: "سفارش‌ها و فاکتورها" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "مدیران و دسترسی‌ها" })).toHaveCount(0);
  await page.getByRole("button", { name: "بستن منو" }).click();
  await page.locator("#dashboard-order-search").fill("AC-0008932");
  await page.locator("#dashboard-order-search").press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/orders\?q=AC-0008932$/u);
  await expect(page.getByRole("heading", { name: "سفارشی با این فیلترها پیدا نشد" })).toBeVisible();
  await page.goto("/dashboard/admins");
  await expect(page.getByRole("heading", { name: /۴۰۳/u })).toBeVisible();
});
