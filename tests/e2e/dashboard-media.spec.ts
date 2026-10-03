import AxeBuilder from "@axe-core/playwright";
import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_MEDIA_FIXTURES, "Run with npm run test:e2e:media");
test.describe.configure({ mode: "default" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill("e2e-owner");
  await page.locator("#admin-password").fill("dashboard-e2e-password-12345");
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

test("owner filters, edits and selects media on mobile and desktop", async ({ page }) => {
  await page.route(/\/api\/media\/[a-f0-9]{24}\/file/u, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
    }),
  );
  await login(page);
  await page.goto("/dashboard/media");
  await expect(page.getByRole("heading", { name: "کتابخانه رسانه" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "تصویر آزمایشی محصول" })).toBeVisible();
  await page.getByRole("button", { name: "فهرستی" }).click();
  const checkbox = page.getByRole("checkbox", { name: "انتخاب تصویر آزمایشی محصول" });
  await checkbox.focus();
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(page.getByText("۱ مورد انتخاب‌شده")).toBeVisible();
  await page.getByRole("button", { name: "جزئیات تصویر آزمایشی محصول" }).click();
  const detail = page.getByRole("dialog", { name: "جزئیات رسانه" });
  await expect(detail.getByRole("textbox", { name: "عنوان" })).toHaveValue("تصویر آزمایشی محصول");
  await detail.getByRole("textbox", { name: "متن جایگزین تصویر" }).fill("فنجان لاته");
  await detail.getByRole("button", { name: "ذخیره اطلاعات" }).click();
  await expect(detail.getByRole("status")).toContainText("ذخیره شد");
  await detail.getByRole("button", { name: "بستن جزئیات" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "تصویر آزمایشی محصول" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "جزئیات تصویر آزمایشی محصول" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "جزئیات رسانه" })
      .getByRole("textbox", { name: "متن جایگزین تصویر" }),
  ).toHaveValue("فنجان لاته");
});

test("upload sends bytes directly, reports progress and finalizes", async ({ page }) => {
  await login(page);
  const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
  let directCalls = 0;
  let completeCalls = 0;
  await page.route("**/api/media", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON().byteSize).toBe(8);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          id,
          status: "pending",
          upload: {
            url: new URL("/fake-minio", route.request().url()).toString(),
            fields: { key: "private/e2e" },
            expiresIn: 60,
          },
        },
      }),
    });
  });
  await page.route("**/fake-minio", (route) => {
    directCalls++;
    return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route(`**/api/media/${id}/complete`, (route) => {
    completeCalls++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: { id, status: "ready" } }),
    });
  });
  await page.goto("/dashboard/media/upload");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "انتخاب فایل‌ها" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from("12345678"),
  });
  await expect(page.getByText("sample.png")).toBeVisible();
  await page.getByRole("button", { name: "شروع بارگذاری" }).click();
  await expect(page.getByText("۱ تصویر تکمیل‌شده")).toBeVisible();
  expect(directCalls).toBe(1);
  expect(completeCalls).toBe(1);
});

test("upload handles duplicate selection and retries a failed direct transfer", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("status of 503");
  await login(page);
  const id = "bbbbbbbbbbbbbbbbbbbbbbbb";
  let attempts = 0;
  await page.route("**/api/media", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            value: {
              id,
              status: "pending",
              upload: {
                url: new URL("/fake-minio-retry", route.request().url()).toString(),
                fields: { key: "private/retry" },
                expiresIn: 60,
              },
            },
          }),
        })
      : route.continue(),
  );
  await page.route("**/fake-minio-retry", (route) => {
    attempts++;
    return route.fulfill({ status: attempts === 1 ? 503 : 204 });
  });
  await page.route(`**/api/media/${id}/complete`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: { id, status: "ready" } }),
    }),
  );
  await page.goto("/dashboard/media/upload");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "انتخاب فایل‌ها" }).click();
  const chooser = await chooserPromise;
  const file = { name: "retry.png", mimeType: "image/png", buffer: Buffer.from("12345678") };
  await chooser.setFiles(file);
  await chooser.setFiles([]);
  await chooser.setFiles(file);
  await expect(page.getByRole("heading", { name: "صف بارگذاری (۱)" })).toBeVisible();
  await page.getByRole("button", { name: "شروع بارگذاری" }).click();
  await expect(page.getByText("بارگذاری مستقیم ناموفق بود (503).")).toBeVisible();
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await page.getByRole("button", { name: "شروع بارگذاری" }).click();
  await expect(page.getByText("۱ تصویر تکمیل‌شده")).toBeVisible();
  expect(attempts).toBe(2);
});

test("failed finalization can be recovered after refresh without a second upload", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("status of 503");
  await login(page);
  const id = "cccccccccccccccccccccccc";
  let directCalls = 0;
  let completeCalls = 0;
  await page.route("**/api/media", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            value: {
              id,
              status: "pending",
              upload: {
                url: new URL("/fake-minio-recover", route.request().url()).toString(),
                fields: { key: "private/recover" },
                expiresIn: 60,
              },
            },
          }),
        })
      : route.continue(),
  );
  await page.route("**/fake-minio-recover", (route) => {
    directCalls++;
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/media/${id}/complete`, (route) => {
    completeCalls++;
    return route.fulfill({
      status: completeCalls === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        completeCalls === 1
          ? { ok: false, error: { code: "UNAVAILABLE", message: "Temporary" } }
          : { ok: true, value: { id, status: "ready" } },
      ),
    });
  });
  await page.goto("/dashboard/media/upload");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "انتخاب فایل‌ها" }).click();
  await (
    await chooserPromise
  ).setFiles({ name: "recover.png", mimeType: "image/png", buffer: Buffer.from("12345678") });
  await page.getByRole("button", { name: "شروع بارگذاری" }).click();
  await expect(page.locator('main [role="alert"]')).toContainText(
    "سرویس رسانه موقتاً در دسترس نیست",
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "بارگذاری‌های قابل بازیابی" })).toBeVisible();
  await page.getByRole("button", { name: "تلاش برای تکمیل" }).click();
  await expect(page.getByText("بارگذاری پیشین تکمیل شد.")).toBeVisible();
  expect(directCalls).toBe(1);
  expect(completeCalls).toBe(2);
});

test("in-use image cannot be deleted until product references are replaced", async ({ page }) => {
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    const original = await connection.db!.collection("media_assets").findOne({
      title: "تصویر آزمایشی محصول",
    });
    expect(original).toBeTruthy();
    const id = new mongoose.Types.ObjectId();
    await connection.db!.collection("media_assets").insertOne({
      ...original,
      _id: id,
      objectKey: `e2e-disposable-${id}`,
      objectVersion: String(id),
      title: "تصویر قابل حذف آزمایشی",
      initiationKey: String(id),
      referenceGuard: 0,
    });
  } finally {
    await connection.close();
  }
  await page.route(/\/api\/media\/[a-f0-9]{24}\/file/u, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
    }),
  );
  await login(page);
  const category = await page.evaluate(async () => {
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "گروه تست رسانه", status: "published", mediaId: null }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(category.status, JSON.stringify(category.body)).toBe(200);
  await page.goto("/dashboard/products/new");
  await page.getByRole("textbox", { name: "نام محصول" }).fill("محصول دارای رسانه");
  await page.getByRole("combobox", { name: "دسته‌بندی" }).selectOption(category.body.value.id);
  await page.getByRole("spinbutton", { name: "قیمت پایه (تومان)" }).fill("50000");
  await page.getByRole("textbox", { name: "توضیح کوتاه" }).fill("محصول تست رسانه");
  await page.getByRole("button", { name: "انتخاب از کتابخانه رسانه" }).click();
  await page.getByRole("button", { name: /تصویر قابل حذف آزمایشی/u }).click();
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[a-f0-9]{24}$/u);
  await page.goto("/dashboard/media");
  await page.getByRole("button", { name: "جزئیات تصویر قابل حذف آزمایشی" }).click();
  const detail = page.getByRole("dialog", { name: "جزئیات رسانه" });
  await expect(detail.getByRole("heading", { name: "موارد استفاده (۱)" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "حذف رسانه" })).toBeDisabled();
  await detail.getByRole("button", { name: "جایگزینی ارجاع‌ها" }).click();
  await page
    .getByRole("dialog", { name: "انتخاب تصویر" })
    .getByRole("button", { name: /تصویر جایگزین آزمایشی/u })
    .click();
  await expect(detail.getByRole("heading", { name: "موارد استفاده (۰)" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "حذف رسانه" })).toBeEnabled();
  await detail.getByRole("button", { name: "حذف رسانه" }).click();
  const confirmation = page.getByRole("dialog", { name: "حذف همیشگی رسانه؟" });
  const requiredText = confirmation.getByRole("textbox", {
    name: "برای تأیید، «حذف» را بنویسید",
  });
  await requiredText.pressSequentially("حذف");
  await expect(requiredText).toHaveValue("حذف");
  await expect(confirmation.getByRole("button", { name: "حذف برای همیشه" })).toBeEnabled();
  await confirmation.getByRole("button", { name: "حذف برای همیشه" }).click();
  await expect(detail).not.toBeVisible();
});
