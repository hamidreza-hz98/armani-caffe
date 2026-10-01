import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:dashboard");
test.describe.configure({ mode: "serial" });

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
  await expect(page.getByRole("heading", { name: /خوش آمدید/u })).toBeVisible();
  await expect(
    page.locator("aside").getByRole("link", { name: "مدیران و دسترسی‌ها" }),
  ).toBeVisible();
  const created = await page.evaluate(async (password) => {
    const response = await fetch("/api/admins", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "e2e-cashier",
        displayName: "صندوقدار آزمایشی",
        phone: "09123456788",
        role: "CASHIER",
        password,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, password);
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
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
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "e2e-cashier");
  await page.getByRole("button", { name: "باز کردن منوی مدیریت" }).click();
  const nav = page.getByRole("navigation", { name: "ناوبری مدیریت" });
  await expect(nav.getByRole("link", { name: "سفارش‌ها و فاکتورها" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "مدیران و دسترسی‌ها" })).toHaveCount(0);
  await page.getByRole("button", { name: "بستن منو" }).click();
  await page.locator("#dashboard-order-search").fill("AC-0008932");
  await page.locator("#dashboard-order-search").press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/orders\?q=AC-0008932$/u);
  await expect(page.getByText("سفارشی با این شماره پیدا نشد.", { exact: false })).toBeVisible();
  await page.goto("/dashboard/admins");
  await expect(page.getByRole("heading", { name: /۴۰۳/u })).toBeVisible();
});
