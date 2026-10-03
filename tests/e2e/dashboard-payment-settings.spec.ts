import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:payment-settings");
test.describe.configure({ mode: "default" });
const password = "dashboard-e2e-password-12345";
const dummySecret = "dummy-test-only-credential-12345";

async function login(page: import("@playwright/test").Page, username = "e2e-owner") {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

test("owner sees only installed choices, can rotate masked credentials, and gets honest probe failure", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("400");
  await login(page);
  const seeded = await page.evaluate(async (secret) => {
    const current = await (await fetch("/api/settings/payment")).json();
    const response = await fetch("/api/settings/payment", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "payment-browser-secret-seed",
      },
      body: JSON.stringify({
        revision: current.value.revision,
        values: current.value.values,
        secrets: { gatewayCredential: secret },
      }),
    });
    return response.status;
  }, dummySecret);
  expect(seeded).toBe(200);
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  const before = await connection
    .db!.collection("settings")
    .findOne({ kind: "payment" }, { projection: { encryptedPayload: 1 } });
  await connection.close();
  expect(before?.encryptedPayload).toBeTruthy();
  expect(String(before?.encryptedPayload)).not.toContain(dummySecret);
  await page.goto("/dashboard/settings/payment");
  await expect(page.getByRole("heading", { name: "درگاه‌های پرداخت" })).toBeVisible();
  await expect(page.getByLabel("افزودن درگاه نصب‌شده")).toBeDisabled();
  await expect(page.getByText("ثبت‌شده و پنهان")).toBeVisible();
  expect(await page.locator("body").innerHTML()).not.toContain(dummySecret);
  const read = await page.evaluate(async () => ({
    generic: await (await fetch("/api/settings/payment")).text(),
    dashboard: await (await fetch("/api/admin/payment/settings")).text(),
  }));
  expect(read.generic).not.toContain(dummySecret);
  expect(read.dashboard).not.toContain(dummySecret);
  await page.getByRole("button", { name: "بررسی وضعیت نصب" }).click();
  await expect(page.getByText("آداپتور این درگاه روی سرور نصب نیست.")).toBeVisible();
  const rejected = await page.evaluate(async () => {
    const current = await (await fetch("/api/admin/payment/settings")).json();
    const response = await fetch("/api/admin/payment/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "payment-unsupported-test",
      },
      body: JSON.stringify({
        revision: current.value.revision,
        values: {
          ...current.value.values,
          providers: [{ id: "iranian-gateway", enabled: false, priority: 0, mode: "sandbox" }],
        },
      }),
    });
    return response.status;
  });
  expect(rejected).toBe(400);
  await page.getByRole("checkbox", { name: /چرخش رمزنگاری/u }).check();
  await expect(page.getByText(/تغییرات ذخیره‌نشده دارید/u)).toBeVisible();
  await page.getByRole("link", { name: "داشبورد", exact: true }).click();
  await page
    .getByRole("dialog", { name: "تغییرات ذخیره‌نشده" })
    .getByRole("button", { name: "انصراف" })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/settings\/payment$/u);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).first().click();
  await expect(page.getByText("تنظیمات پرداخت ذخیره شد.")).toBeVisible();
  const after = await page.evaluate(
    async () => await (await fetch("/api/admin/payment/settings")).text(),
  );
  expect(after).not.toContain(dummySecret);
  const verified = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    const current = await verified
      .db!.collection("settings")
      .findOne({ kind: "payment" }, { projection: { encryptedPayload: 1 } });
    expect(current?.encryptedPayload).toBeTruthy();
    expect(current?.encryptedPayload).not.toBe(before?.encryptedPayload);
    expect(String(current?.encryptedPayload)).not.toContain(dummySecret);
  } finally {
    await verified.close();
  }
});

test("cashier cannot open page or read/mutate/probe payment settings", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("403");
  await login(page);
  const created = await page.evaluate(async (initialPassword) => {
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "e2e-cashier-payment-settings",
        displayName: "صندوقدار پرداخت",
        phone: "09123456783",
        role: "CASHIER",
        password: initialPassword,
      }),
    });
    return response.status;
  }, password);
  expect(created).toBe(200);
  await page.context().clearCookies();
  await login(page, "e2e-cashier-payment-settings");
  await page.goto("/dashboard/settings/payment");
  await expect(page.getByRole("heading", { name: "درگاه‌های پرداخت" })).toHaveCount(0);
  const statuses = await page.evaluate(async () => {
    const read = await fetch("/api/admin/payment/settings");
    const update = await fetch("/api/admin/payment/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "cashier-payment-test" },
      body: "{}",
    });
    const probe = await fetch("/api/admin/payment/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "fake" }),
    });
    return [read.status, update.status, probe.status];
  });
  expect(statuses).toEqual([403, 403, 403]);
});
