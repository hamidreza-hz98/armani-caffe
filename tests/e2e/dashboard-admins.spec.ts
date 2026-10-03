import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:admins");
test.describe.configure({ mode: "default" });

const password = "dashboard-e2e-password-12345";
async function login(page: import("@playwright/test").Page, username = "e2e-owner") {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

test("owner sees protected controls and creates a cashier without leaking secrets", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard/admins");
  await expect(page.getByRole("heading", { name: "مدیران و نقش‌ها" })).toBeVisible();
  const owner = page.locator("article").filter({ hasText: "e2e-owner" });
  await expect(owner.getByRole("button", { name: "حذف" })).toBeDisabled();
  await expect(owner.getByRole("button", { name: "غیرفعال‌سازی" })).toBeDisabled();
  await expect(owner.getByRole("button", { name: "بازنشانی رمز" })).toBeDisabled();
  await page.getByRole("button", { name: "افزودن مدیر" }).click();
  const dialog = page.getByRole("dialog", { name: "افزودن مدیر" });
  await expect(dialog.getByRole("option", { name: /مالک/u })).toHaveCount(1);
  await expect(dialog.getByRole("option", { name: /صندوقدار/u })).toHaveCount(1);
  await dialog.getByLabel("نام نمایشی").fill("صندوقدار آزمایشی");
  await dialog.getByLabel("نام کاربری لاتین").fill("e2e-cashier-owner-flow");
  await dialog.getByLabel("موبایل").fill("09123456782");
  await dialog.getByLabel("رمز اولیه").fill(password);
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(page.getByRole("status")).toContainText("ایجاد شد");
  await expect(page.locator("article").filter({ hasText: "e2e-cashier-owner-flow" })).toBeVisible();
  const html = await page.locator("body").innerHTML();
  expect(html).not.toContain(password);
  expect(html).not.toContain("passwordHash");
  const { status, body } = await page.evaluate(async () => {
    const response = await fetch("/api/admins");
    return { status: response.status, body: await response.text() };
  });
  expect(status).toBe(200);
  expect(body).not.toContain(password);
  expect(body).not.toContain("passwordHash");
});

test("validation, failed request, and forged last-owner mutation stay safe", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("409");
  expectedConsoleErrors.push("net::ERR_FAILED");
  await login(page);
  await page.goto("/dashboard/admins");
  await page.getByRole("button", { name: "افزودن مدیر" }).click();
  const dialog = page.getByRole("dialog", { name: "افزودن مدیر" });
  await dialog.getByLabel("نام نمایشی").fill("خطا");
  await dialog.getByLabel("نام کاربری لاتین").fill("invalid name");
  await dialog.getByLabel("موبایل").fill("09123456785");
  await dialog.getByLabel("رمز اولیه").fill(password);
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(dialog.getByRole("alert")).toContainText("نام کاربری");
  await dialog.getByLabel("نام کاربری لاتین").fill("e2e-network-admin");
  await page.route("**/api/admins", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(dialog.getByRole("alert")).toContainText("ارتباط برقرار نشد");
  await page.unroute("**/api/admins");
  await dialog.getByRole("button", { name: "انصراف" }).click();
  const ownerId = await page.evaluate(async () => {
    const response = await fetch("/api/admins");
    const envelope = await response.json();
    return envelope.value.items.find((row: { username: string }) => row.username === "e2e-owner")
      ?.id as string;
  });
  const attempted = await page.evaluate(async (id) => {
    const list = await (await fetch("/api/admins")).json();
    const owner = list.value.items.find((row: { id: string }) => row.id === id);
    const response = await fetch(`/api/admins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: owner.username,
        displayName: owner.displayName,
        phone: owner.phone,
        role: "CASHIER",
        status: "disabled",
        revision: owner.revision,
      }),
    });
    return response.status;
  }, ownerId);
  expect(attempted).toBe(409);
});

test("search, role/status filters, username conflict, edit, reset, disable and delete", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("409");
  await login(page);
  const prerequisite = await page.evaluate(
    async (initialPassword) =>
      (
        await fetch("/api/admins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "e2e-cashier-admins",
            displayName: "صندوقدار آزمایشی",
            phone: "09123456788",
            role: "CASHIER",
            password: initialPassword,
          }),
        })
      ).status,
    password,
  );
  expect(prerequisite).toBe(200);
  await page.goto("/dashboard/admins?q=e2e-cashier-admins&role=CASHIER&status=active");
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "افزودن مدیر" }).click();
  let dialog = page.getByRole("dialog", { name: "افزودن مدیر" });
  await dialog.getByLabel("نام نمایشی").fill("تکراری");
  await dialog.getByLabel("نام کاربری لاتین").fill("e2e-cashier-admins");
  await dialog.getByLabel("موبایل").fill("09123456787");
  await dialog.getByLabel("رمز اولیه").fill(password);
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(dialog.getByRole("alert")).toContainText("تکراری");
  await dialog.getByRole("button", { name: "انصراف" }).click();
  let row = page.locator("article").filter({ hasText: "e2e-cashier-admins" });
  await row.getByRole("button", { name: "ویرایش" }).click();
  dialog = page.getByRole("dialog", { name: "ویرایش مدیر" });
  await dialog.getByLabel("نام نمایشی").fill("صندوقدار ویرایش‌شده");
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(row).toContainText("ویرایش‌شده");
  await row.getByRole("button", { name: "بازنشانی رمز" }).click();
  dialog = page.getByRole("dialog", { name: /بازنشانی رمز/u });
  await dialog.getByLabel("رمز تازه").fill("new-admin-password-123456");
  await dialog.getByRole("button", { name: "ثبت رمز تازه" }).click();
  await expect(page.getByRole("status")).toContainText("باطل شدند");
  await row.getByRole("button", { name: "غیرفعال‌سازی" }).click();
  dialog = page.getByRole("dialog", { name: "غیرفعال‌سازی مدیر" });
  await dialog.getByRole("button", { name: "تأیید" }).click();
  await expect(page.locator("article")).toHaveCount(0);
  await page.goto("/dashboard/admins?q=e2e-cashier-admins&status=disabled");
  row = page.locator("article").filter({ hasText: "e2e-cashier-admins" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "فعال‌سازی" }).click();
  await page
    .getByRole("dialog", { name: "فعال‌سازی مدیر" })
    .getByRole("button", { name: "تأیید" })
    .click();
  await expect(page.getByRole("status")).toContainText("حساب مدیر فعال شد");
  await expect
    .poll(async () => {
      const result = await page.evaluate(
        async () =>
          (await (await fetch("/api/admins?q=e2e-cashier-admins")).json()).value.items[0]?.status,
      );
      return result;
    })
    .toBe("active");
  await expect(page.locator("article")).toHaveCount(0);
  await page.goto("/dashboard/admins?q=e2e-cashier-admins");
  row = page.locator("article").filter({ hasText: "e2e-cashier-admins" });
  await row.getByRole("button", { name: "حذف" }).click();
  dialog = page.getByRole("dialog", { name: "حذف مدیر" });
  await dialog.getByRole("button", { name: "تأیید" }).click();
  await expect(page.getByText("مدیری پیدا نشد")).toBeVisible();
});

test("cashier is blocked from page and API, mobile view is accessible", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("403");
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/admins");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
  const create = await page.evaluate(async () => {
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "e2e-cashier-security",
        displayName: "امنیت",
        phone: "09123456786",
        role: "CASHIER",
        password: "dashboard-e2e-password-12345",
      }),
    });
    return response.status;
  });
  expect(create).toBe(200);
  await page.getByRole("button", { name: /پروفایل/u }).click();
  await page.getByRole("button", { name: "خروج از حساب" }).click();
  await login(page, "e2e-cashier-security");
  await page.goto("/dashboard/admins");
  await expect(page.getByRole("heading", { name: /۴۰۳/u })).toBeVisible();
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/admins");
    return response.status;
  });
  expect(api).toBe(403);
});
