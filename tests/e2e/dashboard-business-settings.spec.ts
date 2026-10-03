import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:business-settings");
test.describe.configure({ mode: "default" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill("e2e-owner");
  await page.locator("#admin-password").fill("dashboard-e2e-password-12345");
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

test("owner saves business and contact details; public metadata and contact sheet follow", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard/settings/business");
  await expect(page.getByRole("heading", { name: "هویت کسب‌وکار" })).toBeVisible();
  await page.getByLabel("نام نمایشی کافه").fill("آرمانی آزمایشی");
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click();
  await expect(page.getByText(/تنظیمات ذخیره شد/u)).toBeVisible();
  await page.goto("/dashboard/settings/contact");
  await page.getByLabel(/تلفن بین‌المللی/u).fill("+982112345678");
  await page.getByLabel("نقشهٔ تأییدشده").selectOption("google");
  await page.getByLabel("عرض جغرافیایی").fill("35.7");
  await page.getByLabel("طول جغرافیایی").fill("51.4");
  await expect(page.getByRole("link", { name: "پیش‌نمایش نقشه در تب جدید" })).toHaveAttribute(
    "href",
    /google\.com\/maps\/search/u,
  );
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click();
  await expect(page.getByText(/تنظیمات ذخیره شد/u)).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("آرمانی آزمایشی").first()).toBeVisible();
  await page.getByRole("button", { name: "ارتباط با ما" }).click();
  await expect(page.getByRole("link", { name: /تماس با کافه/u })).toHaveAttribute(
    "href",
    "tel:+982112345678",
  );
});

test("SEO metadata changes and a print test is labeled, audited, and not an order", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard/settings/seo");
  await page.getByLabel("عنوان پیش‌فرض").fill("منوی آرمانی");
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click();
  await expect(page.getByText(/تنظیمات ذخیره شد/u)).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveTitle(/منوی آرمانی/u);
  await page.goto("/dashboard/settings/printing");
  await expect(page.getByText(/چاپ آزمایشی مرورگر هیچ سفارش/u)).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "چاپ آزمایشی مرورگر" }).click();
  await page
    .getByRole("dialog", { name: "ساخت برگهٔ آزمایشی؟" })
    .getByRole("button", { name: "ساخت برگهٔ آزمایشی" })
    .click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(
    popup.getByRole("heading", { name: "چاپ آزمایشی — بدون سفارش یا پرداخت" }),
  ).toBeVisible();
  await expect(popup.getByText(/به پل چاپ ارسال نمی‌شود/u)).toBeVisible();
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    expect(
      await connection
        .db!.collection("audit_events")
        .countDocuments({ action: "print.browser_test_requested" }),
    ).toBe(1);
    expect(await connection.db!.collection("print_jobs").countDocuments()).toBe(0);
  } finally {
    await connection.close();
  }
});

test("reset, unsaved navigation and stale revision are handled without discarding input", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("409");
  await login(page);
  await page.goto("/dashboard/settings/business");
  const title = page.getByLabel("نام نمایشی کافه");
  const original = await title.inputValue();
  await title.fill("تغییر موقت");
  await page.getByRole("button", { name: "بازنشانی تغییرات" }).click();
  await expect(title).toHaveValue(original);
  await title.fill("تغییر ذخیره‌نشده");
  await page.getByRole("link", { name: "همهٔ تنظیمات" }).click();
  await page
    .getByRole("dialog", { name: "تغییرات ذخیره‌نشده" })
    .getByRole("button", { name: "انصراف" })
    .click();
  await expect(page).toHaveURL(/\/settings\/business$/u);
  const external = await page.evaluate(async () => {
    const response = await fetch("/api/settings/business");
    const current = await response.json();
    return fetch("/api/settings/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        revision: current.value.revision,
        values: { ...current.value.values, title: "ویرایش هم‌زمان" },
      }),
    }).then((result) => result.status);
  });
  expect(external).toBe(200);
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click();
  await expect(page.getByText(/تنظیمات هم‌زمان تغییر کرده‌اند/u)).toBeVisible();
  await expect(title).toHaveValue("تغییر ذخیره‌نشده");
  await page.getByRole("button", { name: "بازخوانی نسخهٔ سرور" }).click();
  await page
    .getByRole("dialog", { name: "کنارگذاشتن تغییرات؟" })
    .getByRole("button", { name: "بازخوانی نسخهٔ سرور" })
    .click();
  await expect(title).toHaveValue("ویرایش هم‌زمان");
});
