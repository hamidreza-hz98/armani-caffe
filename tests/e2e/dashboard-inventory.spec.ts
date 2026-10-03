import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:inventory");
test.describe.configure({ mode: "default" });
const password = "dashboard-e2e-password-12345";
let itemId = "";

async function login(page: import("@playwright/test").Page, username = "e2e-owner") {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
async function stock(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/inventory/overview");
    const result = await response.json();
    return result.value as {
      items: { id: string; name: string; onHand: number; stockStatus: string }[];
      requests: { id: string; status: string; requestedDelta: number }[];
    };
  });
}
async function createEmptyItem(page: import("@playwright/test").Page, name: string) {
  const result = await page.evaluate(async (itemName) => {
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: itemName, unit: "gram", reorderLevel: 100 }),
    });
    return { status: response.status, body: await response.json() };
  }, name);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.value.id as string;
}
async function requestChange(
  page: import("@playwright/test").Page,
  kind: string,
  amount: string,
  unit: string,
  reason: string,
  itemName = "دانه قهوه آزمایشی",
) {
  const row = page.getByRole("row").filter({ hasText: itemName });
  await row.getByRole("button", { name: "ثبت تغییر" }).click();
  const dialog = page.getByRole("dialog", { name: /درخواست تغییر موجودی/u });
  await expect(dialog.getByLabel("نوع تغییر")).toBeFocused();
  await dialog.getByLabel("نوع تغییر").selectOption(kind);
  await dialog.getByLabel("مقدار").fill(amount);
  await dialog.getByLabel("واحد").selectOption(unit);
  await dialog.getByLabel("دلیل").fill(reason);
  await dialog.getByRole("button", { name: "بررسی و ادامه" }).click();
  await dialog.getByRole("button", { name: "تأیید و ثبت درخواست" }).click();
  await expect(dialog).toHaveCount(0);
}
async function approveLatest(
  page: import("@playwright/test").Page,
  decision: "approved" | "rejected" = "approved",
  itemName = "دانه قهوه آزمایشی",
) {
  await page.getByRole("tab", { name: /درخواست‌های تغییر/u }).click();
  const card = page.locator("article").filter({ hasText: itemName }).first();
  await card
    .getByRole("button", { name: decision === "approved" ? "تأیید" : "رد درخواست" })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(itemName);
  await confirm
    .getByRole("button", { name: decision === "approved" ? "تأیید نهایی" : "رد نهایی" })
    .click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole("tab", { name: "اقلام موجودی" }).click();
}

test("owner creates item, confirms initial stock, purchase and waste; pending is never stock", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("heading", { name: "موجودی و تأییدها" })).toBeVisible();
  await page.getByRole("button", { name: "افزودن قلم" }).click();
  const editor = page.getByRole("dialog", { name: "افزودن قلم موجودی" });
  await editor.getByLabel("نام قلم").fill("دانه قهوه آزمایشی");
  await editor.getByLabel("واحد پایه").selectOption("gram");
  await editor.getByLabel("حد هشدار").fill("100");
  await editor.getByRole("button", { name: "ذخیره" }).click();
  await expect(editor).toHaveCount(0);
  itemId = (await stock(page)).items.find((row) => row.name === "دانه قهوه آزمایشی")!.id;
  await requestChange(page, "initial", "80", "gram", "موجودی آغازین");
  expect((await stock(page)).items.find((row) => row.id === itemId)?.onHand).toBe(0);
  await approveLatest(page);
  expect((await stock(page)).items.find((row) => row.id === itemId)).toMatchObject({
    onHand: 80,
    stockStatus: "low",
  });
  await requestChange(page, "purchase", "1", "kilogram", "خرید یک کیلو");
  expect((await stock(page)).items.find((row) => row.id === itemId)?.onHand).toBe(80);
  await approveLatest(page);
  expect((await stock(page)).items.find((row) => row.id === itemId)).toMatchObject({
    onHand: 1080,
    stockStatus: "available",
  });
  await requestChange(page, "waste", "-1080", "gram", "ضایعات آزمایشی");
  await approveLatest(page);
  expect((await stock(page)).items.find((row) => row.id === itemId)).toMatchObject({
    onHand: 0,
    stockStatus: "out",
  });
  await page
    .getByRole("row")
    .filter({ hasText: "دانه قهوه آزمایشی" })
    .getByRole("button", { name: "جزئیات و گردش" })
    .click();
  const detail = page.getByRole("dialog", { name: "دانه قهوه آزمایشی" });
  await expect(
    detail.getByRole("heading", { name: "دفتر گردش (حداکثر ۲۰۰ حرکت اخیر)" }),
  ).toBeVisible();
  await expect(detail.getByRole("row")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("row").filter({ hasText: "دانه قهوه آزمایشی" })).toBeVisible();
});

test("stale and duplicate approvals, negative stock, unit mismatch and rejection remain safe", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("409", "400");
  await login(page);
  const itemName = "دانه آزمون خطا";
  itemId = await createEmptyItem(page, itemName);
  await page.goto("/dashboard/inventory");
  const wrongUnit = await page.evaluate(async (id) => {
    const response = await fetch("/api/inventory/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventoryItemId: id,
        kind: "purchase",
        quantity: "1",
        unit: "liter",
        reason: "wrong unit",
        idempotencyKey: "dashboard:e2e-wrong-unit",
      }),
    });
    return response.status;
  }, itemId);
  expect(wrongUnit).toBe(400);
  const proposed = await page.evaluate(async (id) => {
    const response = await fetch("/api/inventory/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventoryItemId: id,
        kind: "adjustment",
        quantity: "-1",
        unit: "gram",
        reason: "اصلاح نامعتبر",
        idempotencyKey: "dashboard:e2e-negative-adjustment",
      }),
    });
    return response.status;
  }, itemId);
  expect(proposed).toBe(200);
  await page.reload();
  const pending = (await stock(page)).requests.find(
    (row) => row.status === "pending" && row.requestedDelta === -1,
  )!;
  const first = await page.evaluate(async (id) => {
    const response = await fetch(`/api/inventory/requests/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    return response.status;
  }, pending.id);
  expect(first).toBe(409);
  expect((await stock(page)).items.find((row) => row.id === itemId)?.onHand).toBe(0);
  await approveLatest(page, "rejected", itemName);
  const duplicate = await page.evaluate(async (id) => {
    const response = await fetch(`/api/inventory/requests/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "rejected" }),
    });
    return response.status;
  }, pending.id);
  expect(duplicate).toBe(200);
  const opposite = await page.evaluate(async (id) => {
    const response = await fetch(`/api/inventory/requests/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    return response.status;
  }, pending.id);
  expect(opposite).toBe(409);
  expect((await stock(page)).items.find((row) => row.id === itemId)?.onHand).toBe(0);
});

test("cashier submits permitted purchase but cannot approve or edit items", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("403");
  await login(page);
  const itemName = "دانه صندوق";
  itemId = await createEmptyItem(page, itemName);
  const created = await page.evaluate(async (initialPassword) => {
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "e2e-cashier-inventory",
        displayName: "صندوقدار انبار",
        phone: "09123456784",
        role: "CASHIER",
        password: initialPassword,
      }),
    });
    return response.status;
  }, password);
  expect(created).toBe(200);
  await page.context().clearCookies();
  await login(page, "e2e-cashier-inventory");
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("button", { name: "افزودن قلم" })).toHaveCount(0);
  await requestChange(page, "purchase", "10", "gram", "خرید صندوق", itemName);
  await page.getByRole("tab", { name: /درخواست‌های تغییر/u }).click();
  await expect(
    page.locator("article").getByRole("button", { name: "تأیید", exact: true }),
  ).toHaveCount(0);
  const pending = (await stock(page)).requests.find(
    (row) => row.status === "pending" && row.requestedDelta === 10,
  )!;
  const denied = await page.evaluate(async (id) => {
    const response = await fetch(`/api/inventory/requests/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    return response.status;
  }, pending.id);
  expect(denied).toBe(403);
  expect((await stock(page)).items.find((row) => row.id === itemId)?.onHand).toBe(0);
});
