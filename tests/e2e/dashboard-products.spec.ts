import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_PRODUCT_FIXTURES, "Run with npm run test:e2e:products");
test.describe.configure({ mode: "serial" });
const password = "dashboard-e2e-password-12345";
async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
const imageRoute = /\/api\/media\/[a-f0-9]{24}\/file/u;
const fakeImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#9b7137"/></svg>';

test("owner creates, publishes, edits, resolves conflict and archives a product", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("status of 409 (Conflict)");
  await page.route(imageRoute, async (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: fakeImage }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "e2e-owner");
  const category = await page.evaluate(async () => {
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "قهوه آزمایشی", status: "published", mediaId: null }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(category.status, JSON.stringify(category.body)).toBe(200);
  await page.goto("/dashboard/products/new");
  await page.getByRole("textbox", { name: "نام محصول" }).fill("لاته آزمایشی");
  await page.getByRole("combobox", { name: "دسته‌بندی" }).selectOption(category.body.value.id);
  await page.getByRole("spinbutton", { name: "قیمت پایه (تومان)" }).fill("88000");
  await page.getByRole("textbox", { name: "توضیح کوتاه" }).fill("قهوه با شیر تازه");
  await page.getByRole("button", { name: "انتخاب از کتابخانه رسانه" }).click();
  await page.getByRole("button", { name: /تصویر آزمایشی محصول/u }).click();
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[a-f0-9]{24}$/u);
  await expect(page.getByRole("heading", { name: /ویرایش لاته آزمایشی/u })).toBeVisible();
  await page.getByRole("button", { name: "انتشار", exact: true }).click();
  await expect(page.getByText("محصول منتشر شد.")).toBeVisible();
  await page.goto("/dashboard/products?status=published&q=لاته");
  await expect(page.getByRole("table")).toContainText("لاته آزمایشی");
  await page.getByRole("table").getByRole("link", { name: "ویرایش" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[a-f0-9]{24}$/u);
  const productId = new URL(page.url()).pathname.split("/").at(-1)!;
  const external = await page.evaluate(async (id) => {
    const current = await (await fetch(`/api/products/${id}`)).json();
    const response = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: current.value.revision, name: "لاته ویرایش بیرونی" }),
    });
    return { status: response.status, body: await response.json() };
  }, productId);
  expect(external.status, JSON.stringify(external.body)).toBe(200);
  await page.getByRole("textbox", { name: "نام محصول" }).fill("لاته ویرایش محلی");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByRole("button", { name: "بارگذاری نسخه جدید" })).toBeVisible();
  await page.getByRole("button", { name: "بارگذاری نسخه جدید" }).click();
  await expect(page.getByRole("textbox", { name: "نام محصول" })).toHaveValue("لاته ویرایش بیرونی");
  await page.getByRole("textbox", { name: "نام محصول" }).fill("لاته نهایی");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "بازگشت به فهرست" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[a-f0-9]{24}$/u);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("تغییرات ذخیره شد.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "بایگانی" }).click();
  await expect(page.getByText("محصول بایگانی شد.")).toBeVisible();
  await page.goto("/dashboard/products?status=archived&q=لاته");
  await expect(page.getByRole("table")).toContainText("لاته نهایی");
  await page.goto("/dashboard/products/new");
  await page.getByRole("textbox", { name: "نام محصول" }).fill("پیش‌نویس بدون تصویر");
  await page.getByRole("combobox", { name: "دسته‌بندی" }).selectOption(category.body.value.id);
  await page.getByRole("spinbutton", { name: "قیمت پایه (تومان)" }).fill("50000");
  await page.getByRole("textbox", { name: "توضیح کوتاه" }).fill("توضیح آزمایشی");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[a-f0-9]{24}$/u);
  await page.getByRole("button", { name: "انتشار", exact: true }).click();
  await expect(
    page.getByText("برای انتشار، توضیح کوتاه، قیمت مثبت و تصویر لازم است."),
  ).toBeVisible();
  await page.goto("/dashboard/products?status=draft&q=پیش‌نویس");
  await page.getByRole("checkbox", { name: "انتخاب پیش‌نویس بدون تصویر" }).first().check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "بایگانی" }).click();
  await expect(page.getByRole("status")).toContainText("۱ از ۱ محصول به‌روزرسانی شد");
  const cashier = await page.evaluate(
    async (password) =>
      (
        await fetch("/api/admins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "e2e-product-cashier",
            displayName: "صندوق‌دار محصول",
            phone: "09123456788",
            role: "CASHIER",
            password,
          }),
        })
      ).status,
    password,
  );
  expect(cashier).toBe(200);
});

test("cashier sees read-only responsive cards and cannot mutate", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("status of 403 (Forbidden)");
  await page.route(imageRoute, async (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: fakeImage }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "e2e-product-cashier");
  await page.goto("/dashboard/products?status=archived&q=لاته");
  await expect(page.getByRole("table")).toBeHidden();
  await expect(page.getByRole("article")).toContainText("لاته نهایی");
  await expect(page.getByRole("link", { name: "+ محصول جدید" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("article").getByRole("link", { name: "مشاهده" }).click();
  await expect(page.getByText("این صفحه برای نقش صندوق‌دار فقط خواندنی است.")).toBeVisible();
  await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toHaveCount(0);
  await page.goto("/dashboard/products/new");
  await expect(page.getByRole("heading", { name: /۴۰۳/u })).toBeVisible();
  await page.goto("/dashboard/products?status=archived&q=لاته");
  await page.getByRole("article").getByRole("link", { name: "مشاهده" }).click();
  const denied = await page.evaluate(async () => {
    const id = location.pathname.split("/").at(-1);
    const current = await (await fetch(`/api/products/${id}`)).json();
    return (
      await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "محصول غیرمجاز", categoryId: current.value.categoryId }),
      })
    ).status;
  });
  expect(denied).toBe(403);
});
