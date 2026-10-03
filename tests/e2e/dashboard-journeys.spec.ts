import AxeBuilder from "@axe-core/playwright";
import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:dashboard:smoke");

const password = "dashboard-e2e-password-12345";

async function login(page: import("@playwright/test").Page, username = "e2e-owner") {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function expectNoOverflow(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: document.documentElement.scrollWidth <= window.innerWidth,
        body: document.body.scrollWidth <= window.innerWidth,
      })),
    )
    .toEqual({ document: true, body: true });
}

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).include("main").analyze();
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}

test("owner dashboard metrics and filters survive reload on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await expect(page.getByRole("heading", { name: "نمای کلی" })).toBeVisible();
  await expect(page.getByRole("region", { name: "آمار فروش" })).toBeVisible();
  await expect(page.getByRole("region", { name: "نیازمند اقدام" })).toBeVisible();
  await page.getByRole("link", { name: "۷ روز" }).click();
  await expect(page).toHaveURL(/\/dashboard\?range=7$/u);
  await page.reload();
  await expect(page.getByRole("link", { name: "۷ روز" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "روند فروش ۷ روزه" })).toBeVisible();
  await expectNoOverflow(page);
  await expectNoSeriousAxeViolations(page);
});

test("cashier mobile permissions and expired sessions fail closed", async ({
  page,
  expectedConsoleErrors,
}, testInfo) => {
  expectedConsoleErrors.push("403");
  await login(page);
  const suffix = String(testInfo.workerIndex).padStart(2, "0");
  const username = `matrix-cashier-${suffix}`;
  const created = await page.evaluate(
    async ({ username, password, suffix }) => {
      const response = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          displayName: "صندوقدار ماتریس",
          phone: `091200000${suffix}`,
          role: "CASHIER",
          password,
        }),
      });
      return response.status;
    },
    { username, password, suffix },
  );
  expect(created).toBe(200);
  await page.context().clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, username);
  await expect(page.getByRole("region", { name: "آمار فروش" })).toHaveCount(0);
  await page.getByRole("button", { name: "باز کردن منوی مدیریت" }).click();
  const navigation = page.getByRole("navigation", { name: "ناوبری مدیریت" });
  await expect(navigation.getByRole("link", { name: "سفارش‌ها و فاکتورها" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "مدیران و دسترسی‌ها" })).toHaveCount(0);
  await page.getByRole("button", { name: "بستن منو" }).click();
  await page.goto("/dashboard/admins");
  await expect(page.getByRole("heading", { name: /۴۰۳/u })).toBeVisible();
  const denied = await page.evaluate(async () => (await fetch("/api/admins")).status);
  expect(denied).toBe(403);
  await expectNoOverflow(page);
  await expectNoSeriousAxeViolations(page);
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    const cashier = await connection.db!.collection("admins").findOne({ username });
    expect(cashier).not.toBeNull();
    const expired = await connection
      .db!.collection("sessions")
      .updateMany(
        { principalKind: "admin", principalId: cashier!._id, revokedAt: null },
        { $set: { expiresAt: new Date("2000-01-01T00:00:00.000Z") } },
      );
    expect(expired.modifiedCount).toBeGreaterThan(0);
  } finally {
    await connection.close();
  }
  await page.goto("/dashboard/inventory");
  await expect(page).toHaveURL(/\/dashboard\/login\?next=%2Fdashboard%2Finventory$/u);
  await expect(page.getByRole("heading", { name: "ورود به پنل مدیریت" })).toBeVisible();
});

test("login validation and safe redirect recovery are accessible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/login?next=https%3A%2F%2Fevil.example");
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.locator("#admin-username").fill("e2e-owner");
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page).not.toHaveURL(/evil\.example/u);
  await expectNoOverflow(page);
  await expectNoSeriousAxeViolations(page);
});
