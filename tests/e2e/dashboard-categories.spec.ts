import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_PRODUCT_FIXTURES, "Run with npm run test:e2e:categories");
test.describe.configure({ mode: "default" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill("e2e-owner");
  await page.locator("#admin-password").fill("dashboard-e2e-password-12345");
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function create(page: import("@playwright/test").Page, name: string, published = true) {
  await page.getByRole("button", { name: "+ دسته‌بندی جدید" }).click();
  const dialog = page.getByRole("dialog", { name: "دسته‌بندی جدید" });
  await dialog.getByRole("textbox", { name: "نام دسته‌بندی" }).fill(name);
  if (published) await dialog.getByRole("radio", { name: "فعال در منو" }).check();
  await dialog.getByRole("button", { name: "ذخیره دسته‌بندی" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("create, edit, filter, media selection, disable, and delete", async ({ page }) => {
  await page.route(/\/api\/media\/[a-f0-9]{24}\/file/u, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
    }),
  );
  await login(page);
  await page.goto("/dashboard/categories");
  await expect(page.getByRole("heading", { name: "دسته‌بندی‌ها" })).toBeVisible();
  await page.getByRole("button", { name: "+ دسته‌بندی جدید" }).click();
  const unfinished = page.getByRole("dialog", { name: "دسته‌بندی جدید" });
  await unfinished.getByRole("textbox", { name: "نام دسته‌بندی" }).fill("<نام نامعتبر>");
  await unfinished.getByRole("button", { name: "ذخیره دسته‌بندی" }).click();
  await expect(unfinished.getByRole("alert")).toContainText("نام دسته‌بندی");
  await unfinished.getByRole("textbox", { name: "نام دسته‌بندی" }).fill("");
  await unfinished.getByRole("button", { name: "بستن فرم" }).click();
  await expect(unfinished).not.toBeVisible();
  await create(page, "قهوه آزمایشی");
  await expect(page.getByRole("status")).toContainText("منوی عمومی نیز تازه شد");
  const publicList = await page.evaluate(
    async () => (await (await fetch("/api/categories/public")).json()).value,
  );
  expect(publicList.some((item: { name: string }) => item.name === "قهوه آزمایشی")).toBe(true);
  await page.getByRole("button", { name: "ویرایش قهوه آزمایشی" }).click();
  const edit = page.getByRole("dialog", { name: "ویرایش دسته‌بندی" });
  await edit.getByRole("textbox", { name: "نام دسته‌بندی" }).fill("قهوه ویژه آزمایشی");
  await edit.getByRole("button", { name: "انتخاب از کتابخانه رسانه" }).click();
  await page
    .getByRole("dialog", { name: "انتخاب تصویر" })
    .getByRole("button", { name: /تصویر آزمایشی محصول/u })
    .click();
  await edit.getByRole("radio", { name: "غیرفعال / پیش‌نویس" }).check();
  await edit.getByRole("button", { name: "ذخیره دسته‌بندی" }).click();
  await expect(page.getByRole("heading", { name: "قهوه ویژه آزمایشی" })).toBeVisible();
  await page.getByRole("combobox", { name: "وضعیت" }).selectOption("draft");
  await page.getByRole("button", { name: "اعمال فیلتر" }).click();
  await expect(page).toHaveURL(/status=draft/u);
  await expect(page.getByRole("heading", { name: "قهوه ویژه آزمایشی" })).toBeVisible();
  await expect(page.getByRole("button", { name: /انتقال قهوه ویژه آزمایشی به بالا/u })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "پاک‌کردن" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "حذف قهوه ویژه آزمایشی" }).click();
  const deletion = page.getByRole("dialog", { name: "حذف «قهوه ویژه آزمایشی»؟" });
  await expect(deletion).toContainText("محصول وابسته‌ای");
  await deletion.getByRole("button", { name: "حذف دسته‌بندی" }).click();
  await expect(deletion).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "قهوه ویژه آزمایشی" })).toHaveCount(0);
});

test("keyboard reorder persists and a stale reorder reloads confirmed order", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("status of 409");
  await login(page);
  await page.goto("/dashboard/categories");
  await create(page, "دسته یک آزمایش");
  await create(page, "دسته دو آزمایش");
  const before = await page.evaluate(
    async () => (await (await fetch("/api/categories")).json()).value,
  );
  const first = before.items.find((item: { name: string }) => item.name === "دسته یک آزمایش");
  const second = before.items.find((item: { name: string }) => item.name === "دسته دو آزمایش");
  await page.getByRole("button", { name: "انتقال دسته دو آزمایش به بالا" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("ترتیب ذخیره شد");
  const ordered = await page.evaluate(
    async () => (await (await fetch("/api/categories")).json()).value,
  );
  expect(ordered.items.findIndex((item: { id: string }) => item.id === second.id)).toBeLessThan(
    ordered.items.findIndex((item: { id: string }) => item.id === first.id),
  );
  const external = await page.evaluate(async (data) => {
    const response = await fetch("/api/categories/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: data.orderRevision,
        ids: data.items.map((item: { id: string }) => item.id).reverse(),
      }),
    });
    return response.status;
  }, ordered);
  expect(external).toBe(200);
  await page.getByRole("button", { name: "انتقال دسته دو آزمایش به پایین" }).click();
  await expect(page.locator('main [role="alert"]')).toContainText("تغییر کرده");
  const latest = await page.evaluate(
    async () => (await (await fetch("/api/categories")).json()).value,
  );
  const names = await page.locator("main ol li h2").allTextContents();
  expect(names).toEqual(latest.items.map((item: { name: string }) => item.name));
});

test("mouse drag and touch drag persist category order", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/categories");
  await create(page, "کشیدنی یک");
  await create(page, "کشیدنی دو");
  await create(page, "کشیدنی سه");
  const initial = await page.evaluate(
    async () => (await (await fetch("/api/categories")).json()).value,
  );
  const one = initial.items.find((item: { name: string }) => item.name === "کشیدنی یک");
  const two = initial.items.find((item: { name: string }) => item.name === "کشیدنی دو");
  const three = initial.items.find((item: { name: string }) => item.name === "کشیدنی سه");
  await page
    .getByRole("button", { name: "کشیدن کشیدنی یک برای جابه‌جایی" })
    .dragTo(page.locator(`[data-category-id="${three.id}"]`));
  await expect(page.getByRole("status")).toContainText("ترتیب ذخیره شد");
  let current = await page.evaluate(
    async () => (await (await fetch("/api/categories")).json()).value,
  );
  expect(current.items.findIndex((item: { id: string }) => item.id === one.id)).toBeGreaterThan(
    current.items.findIndex((item: { id: string }) => item.id === three.id),
  );
  const handle = page.getByRole("button", { name: "کشیدن کشیدنی دو برای جابه‌جایی" });
  const target = page.locator(`[data-category-id="${one.id}"]`);
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from!.x + from!.width / 2, y: from!.y + from!.height / 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: to!.x + to!.width / 2, y: to!.y + to!.height / 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("status")).toContainText("ترتیب ذخیره شد");
  current = await page.evaluate(async () => (await (await fetch("/api/categories")).json()).value);
  expect(current.items.findIndex((item: { id: string }) => item.id === two.id)).toBeGreaterThan(
    current.items.findIndex((item: { id: string }) => item.id === one.id),
  );
});

test("referenced deletion is blocked and stale edits retain their form", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("status of 409");
  await page.route(/\/api\/media\/[a-f0-9]{24}\/file/u, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
    }),
  );
  await login(page);
  await page.goto("/dashboard/categories");
  await create(page, "دسته وابسته آزمایشی");
  const category = await page.evaluate(async () =>
    (await (await fetch("/api/categories")).json()).value.items.find(
      (item: { name: string }) => item.name === "دسته وابسته آزمایشی",
    ),
  );
  await page.goto("/dashboard/products/new");
  await page.getByRole("textbox", { name: "نام محصول" }).fill("محصول وابسته آزمایشی");
  await page.getByRole("combobox", { name: "دسته‌بندی" }).selectOption(category.id);
  await page.getByRole("spinbutton", { name: "قیمت پایه (تومان)" }).fill("50000");
  await page.getByRole("textbox", { name: "توضیح کوتاه" }).fill("محصول دارای دسته‌بندی");
  await page.getByRole("button", { name: "انتخاب از کتابخانه رسانه" }).click();
  await page
    .getByRole("dialog", { name: "انتخاب تصویر" })
    .getByRole("button", { name: /تصویر آزمایشی محصول/u })
    .click();
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[a-f0-9]{24}$/u);
  await page.getByRole("button", { name: "انتشار", exact: true }).click();
  await expect(page.getByText("محصول منتشر شد.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "محصول وابسته آزمایشی" })).toBeVisible();
  await page.goto("/dashboard/categories");
  await page.getByRole("button", { name: "ویرایش دسته وابسته آزمایشی" }).click();
  const visibility = page.getByRole("dialog", { name: "ویرایش دسته‌بندی" });
  await visibility.getByRole("radio", { name: "غیرفعال / پیش‌نویس" }).check();
  await expect(visibility).toContainText("۱ محصول وابسته دارد");
  await visibility.getByRole("button", { name: "ذخیره دسته‌بندی" }).click();
  await expect(visibility).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("منوی عمومی نیز تازه شد");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "محصول وابسته آزمایشی" })).toHaveCount(0);
  await page.goto("/dashboard/categories");
  await page.getByRole("button", { name: "حذف دسته وابسته آزمایشی" }).click();
  const deletion = page.getByRole("dialog", { name: "حذف «دسته وابسته آزمایشی»؟" });
  await expect(deletion).toContainText("۱ محصول به آن وابسته است");
  await expect(deletion.getByRole("button", { name: "حذف دسته‌بندی" })).toBeDisabled();
  await deletion.getByRole("button", { name: "انصراف" }).click();
  await page.getByRole("button", { name: "ویرایش دسته وابسته آزمایشی" }).click();
  const edit = page.getByRole("dialog", { name: "ویرایش دسته‌بندی" });
  await edit.getByRole("textbox", { name: "نام دسته‌بندی" }).fill("ویرایش محلی دسته");
  const external = await page.evaluate(async (id: string) => {
    const detail = await (await fetch(`/api/categories/${id}`)).json();
    return (
      await fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: detail.value.revision, name: "ویرایش بیرونی دسته" }),
      })
    ).status;
  }, category.id);
  expect(external).toBe(200);
  await edit.getByRole("button", { name: "ذخیره دسته‌بندی" }).click();
  await expect(edit.getByRole("alert")).toContainText("تغییر کرده");
  await expect(edit.getByRole("textbox", { name: "نام دسته‌بندی" })).toHaveValue(
    "ویرایش محلی دسته",
  );
  await edit.getByRole("button", { name: "بستن فرم" }).click();
  await page
    .getByRole("dialog", { name: "کنارگذاشتن تغییرات؟" })
    .getByRole("button", { name: "خروج بدون ذخیره" })
    .click();
});

test("cashier sees categories without management controls", async ({ page }) => {
  await login(page);
  const created = await page.evaluate(
    async () =>
      (
        await fetch("/api/admins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "category-cashier",
            displayName: "صندوق‌دار دسته‌بندی",
            phone: "09123456787",
            role: "CASHIER",
            password: "dashboard-e2e-password-12345",
          }),
        })
      ).status,
  );
  expect(created).toBe(200);
  await page.context().clearCookies();
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill("category-cashier");
  await page.locator("#admin-password").fill("dashboard-e2e-password-12345");
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await page.goto("/dashboard/categories");
  await expect(page.getByRole("heading", { name: "دسته‌بندی‌ها" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ دسته‌بندی جدید" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^ویرایش/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^انتقال/u })).toHaveCount(0);
});
