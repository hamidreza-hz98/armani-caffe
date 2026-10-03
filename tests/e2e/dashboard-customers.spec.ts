import AxeBuilder from "@axe-core/playwright";
import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:customers");
test.describe.configure({ mode: "default" });
const password = "dashboard-e2e-password-12345";
async function login(page: import("@playwright/test").Page, username = "e2e-owner") {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
test("owner creates customer with Jalali birth date, sees indexed list and no-order details", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("409");
  await login(page);
  await page.goto("/dashboard/customers");
  await expect(page.getByRole("heading", { name: "مشتریان" })).toBeVisible();
  await page.getByRole("button", { name: "افزودن مشتری" }).click();
  const editor = page.getByRole("dialog", { name: "افزودن مشتری" });
  await editor.getByLabel("نام نمایشی").fill("مشتری نخست");
  await editor.getByLabel("شماره موبایل").fill("+989123456786");
  await editor.getByLabel(/تاریخ تولد جلالی/u).fill("1375-06-15");
  await editor.getByLabel("رمز اولیه").fill("customer-e2e-password-12345");
  await editor.getByRole("button", { name: "ذخیره" }).click();
  await expect(page.getByRole("status")).toContainText("ایجاد شد");
  const row = page.locator("article").filter({ hasText: "0912 345 6786" });
  await expect(row).toContainText("0912 345 6786");
  await row.getByRole("button", { name: "جزئیات" }).click();
  const details = page.getByRole("dialog", { name: /جزئیات مشتری نخست/u });
  await expect(details.getByText("1375-06-15")).toBeVisible();
  await expect(details.getByText("هنوز سفارشی ثبت نشده است.")).toBeVisible();
  await details.getByRole("button", { name: "بستن" }).click();
  await page.goto("/dashboard/customers?q=مشتری نخست");
  await expect(page.locator("article").filter({ hasText: "مشتری نخست" })).toBeVisible();
  await page.goto("/dashboard/customers");
  await page.getByRole("button", { name: "افزودن مشتری" }).click();
  const duplicate = page.getByRole("dialog", { name: "افزودن مشتری" });
  await duplicate.getByLabel("نام نمایشی").fill("تکراری");
  await duplicate.getByLabel("شماره موبایل").fill("09123456786");
  await duplicate.getByLabel("رمز اولیه").fill("customer-e2e-password-12345");
  await duplicate.getByRole("button", { name: "ذخیره" }).click();
  await expect(duplicate.getByRole("alert")).toContainText("تکراری");
  await duplicate.getByRole("button", { name: "انصراف" }).click();
  const body = await page.evaluate(async () => (await fetch("/api/admin/customers")).text());
  expect(body).not.toContain("passwordHash");
  expect(body).not.toContain("customer-e2e-password-12345");
});

test("search/filter, edit conflict, Jalali round-trip, and anonymization", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("409");
  expectedConsoleErrors.push("401");
  await login(page);
  const created = await page.evaluate(
    async () =>
      (
        await fetch("/api/admin/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: "+989123456788",
            displayName: "مشتری آزمایشی",
            password: "customer-e2e-password-12345",
            birthDate: "1996-09-05",
          }),
        })
      ).status,
  );
  expect(created).toBe(200);
  await page.goto("/dashboard/customers?q=09123456788&status=active");
  const row = page.locator("article").filter({ hasText: "0912 345 6788" });
  await expect(row).toBeVisible();
  const id = await page.evaluate(
    async () =>
      (await (await fetch("/api/admin/customers?q=09123456788")).json()).value.items[0]
        .id as string,
  );
  const fixture = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    expect(
      JSON.stringify(
        await fixture.db!.collection("customers").find({ phone: "+989123456788" }).explain(),
      ),
    ).toContain("customer_phone_unique");
    expect(
      JSON.stringify(
        await fixture
          .db!.collection("customers")
          .find({ status: "active" })
          .sort({ createdAt: -1 })
          .explain(),
      ),
    ).toMatch(/customer_status_(created|recent)/u);
    expect(
      JSON.stringify(
        await fixture
          .db!.collection("customers")
          .find({ $text: { $search: "آزمایشی" } })
          .explain(),
      ),
    ).toContain("customer_name_search");
    expect(
      JSON.stringify(
        await fixture
          .db!.collection("orders")
          .find({ customerId: new mongoose.Types.ObjectId(id) })
          .sort({ placedAt: -1 })
          .explain(),
      ),
    ).toMatch(/order_customer_(placed|recent)/u);
    await fixture.db!.collection("orders").insertMany([
      {
        code: "AC-0093901",
        idempotencyKey: "customer-management-paid",
        customerId: new mongoose.Types.ObjectId(id),
        customer: { phone: "+989123456788", displayName: "مشتری آزمایشی" },
        status: "COMPLETED",
        paymentStatus: "paid",
        totalToman: 250000,
        placedAt: new Date("2026-09-01T12:00:00.000Z"),
      },
      {
        code: "AC-0093902",
        idempotencyKey: "customer-management-pending",
        customerId: new mongoose.Types.ObjectId(id),
        customer: { phone: "+989123456788", displayName: "مشتری آزمایشی" },
        status: "NEW",
        paymentStatus: "pending",
        totalToman: 70000,
        placedAt: new Date("2026-09-02T12:00:00.000Z"),
      },
    ]);
  } finally {
    await fixture.close();
  }
  await row.getByRole("button", { name: "جزئیات" }).click();
  const details = page.getByRole("dialog", { name: /جزئیات مشتری آزمایشی/u });
  await expect(details).toContainText("۲۵۰٬۰۰۰");
  await expect(details).toContainText("AC-0093901");
  await expect(details).not.toContainText("AC-0093902");
  await details.getByRole("button", { name: "بستن" }).click();
  await row.getByRole("button", { name: "ویرایش" }).click();
  let editor = page.getByRole("dialog", { name: "ویرایش مشتری" });
  await expect(editor.getByLabel(/تاریخ تولد جلالی/u)).toHaveValue("1375-06-15");
  await editor.getByLabel("نام نمایشی").fill("مشتری ویرایش‌شده");
  await editor.getByRole("button", { name: "ذخیره" }).click();
  await expect(row).toContainText("ویرایش‌شده");
  await row.getByRole("button", { name: "ویرایش" }).click();
  editor = page.getByRole("dialog", { name: "ویرایش مشتری" });
  await expect(editor.getByLabel(/تاریخ تولد جلالی/u)).toHaveValue("1375-06-15");
  await page.evaluate(async (id) => {
    const detail = (await (await fetch(`/api/admin/customers/${id}`)).json()).value.customer;
    await fetch(`/api/admin/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: detail.phone,
        displayName: "تغییر همزمان",
        birthDate: detail.birthDate,
        status: detail.status,
        revision: detail.revision,
      }),
    });
  }, id);
  await editor.getByLabel("نام نمایشی").fill("تعارض");
  await editor.getByRole("button", { name: "ذخیره" }).click();
  await expect(editor.getByRole("alert")).toContainText("تغییر کرده");
  await editor.getByRole("button", { name: "انصراف" }).click();
  await page.reload();
  await page.locator("article").getByRole("button", { name: "ویرایش" }).click();
  editor = page.getByRole("dialog", { name: "ویرایش مشتری" });
  await editor.getByLabel("وضعیت").selectOption("blocked");
  await editor.getByRole("button", { name: "ذخیره" }).click();
  await expect(page.getByText("مشتری پیدا نشد")).toBeVisible();
  await page.goto("/dashboard/customers?q=09123456788&status=blocked");
  await expect(page.locator("article")).toContainText("مسدود");
  await page.locator("article").getByRole("button", { name: "ویرایش" }).click();
  editor = page.getByRole("dialog", { name: "ویرایش مشتری" });
  await editor.getByLabel("وضعیت").selectOption("active");
  await editor.getByRole("button", { name: "ذخیره" }).click();
  await expect(page.getByText("مشتری پیدا نشد")).toBeVisible();
  await page.goto("/dashboard/customers?q=09123456788&status=active");
  const customerLogin = await page.evaluate(
    async () =>
      (
        await fetch("/api/customer/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: "09123456788", password: "customer-e2e-password-12345" }),
        })
      ).status,
  );
  expect(customerLogin).toBe(200);
  expect(await page.evaluate(async () => (await fetch("/api/customer/auth/session")).status)).toBe(
    200,
  );
  await page.locator("article").getByRole("button", { name: "ناشناس‌سازی" }).click();
  const confirm = page.getByRole("dialog", { name: "ناشناس‌سازی مشتری" });
  await expect(confirm).toContainText("اطلاعات ثبت‌شده هنگام خرید");
  await confirm.getByRole("button", { name: "تأیید ناشناس‌سازی" }).click();
  await expect(page.getByText("مشتری پیدا نشد")).toBeVisible();
  await page.goto("/dashboard/customers?status=anonymized");
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).not.toContainText("0912");
  await expect(page.locator("article")).not.toContainText("تغییر همزمان");
  expect(await page.evaluate(async () => (await fetch("/api/customer/auth/session")).status)).toBe(
    401,
  );
  const retained = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    expect(
      await retained
        .db!.collection("orders")
        .countDocuments({ customerId: new mongoose.Types.ObjectId(id) }),
    ).toBe(2);
    expect(await retained.db!.collection("orders").findOne({ code: "AC-0093901" })).toMatchObject({
      customer: { phone: "+989123456788", displayName: "مشتری آزمایشی" },
      totalToman: 250000,
    });
    const profile = await retained
      .db!.collection("customers")
      .findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(profile).toMatchObject({ status: "anonymized", displayName: null, birthDate: null });
    expect(profile?.phone).not.toBe("+989123456788");
    expect(
      await retained
        .db!.collection("audit_events")
        .countDocuments({ action: "customer.anonymized", "subject.id": id }),
    ).toBe(1);
    expect(
      await retained
        .db!.collection("outbox_events")
        .countDocuments({ eventType: "customer.anonymized", aggregateId: id }),
    ).toBe(1);
  } finally {
    await retained.close();
  }
});

test("cashier can read but cannot mutate customers; mobile layout is accessible", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("403");
  await login(page);
  const created = await page.evaluate(async (password) => {
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "e2e-customer-cashier",
        displayName: "صندوقدار مشتری",
        phone: "09123456784",
        role: "CASHIER",
        password,
      }),
    });
    return response.status;
  }, password);
  expect(created).toBe(200);
  await page.getByRole("button", { name: /پروفایل/u }).click();
  await page.getByRole("button", { name: "خروج از حساب" }).click();
  await login(page, "e2e-customer-cashier");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/customers");
  await expect(page.getByRole("heading", { name: "مشتریان" })).toBeVisible();
  await expect(page.getByRole("button", { name: "افزودن مشتری" })).toHaveCount(0);
  await expect(page.locator("article").getByRole("button", { name: "ویرایش" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
  const response = await page.evaluate(
    async () =>
      (
        await fetch("/api/admin/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: "09123456783",
            displayName: "نامجاز",
            password: "customer-e2e-password-12345",
            birthDate: null,
          }),
        })
      ).status,
  );
  expect(response).toBe(403);
});
