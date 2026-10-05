import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/customer/cart", (route) =>
    route.fulfill({
      json: { ok: false, error: { code: "UNAUTHORIZED", message: "ورود لازم است." } },
    }),
  );
});

test("RTL menu tabs scroll to a category and track the active section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/internal/menu-preview");
  const tabs = page.getByRole("navigation", { name: "دسته‌بندی‌های منو" });
  await expect(tabs.getByRole("link", { name: "قهوه گرم" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await tabs.getByRole("link", { name: "چای و دمنوش" }).click();
  await expect(page).toHaveURL(/#category-0{23}3$/);
  await expect(tabs.getByRole("link", { name: "چای و دمنوش" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect
    .poll(() =>
      page
        .locator("#category-000000000000000000000003")
        .evaluate((node) => node.getBoundingClientRect().top),
    )
    .toBeLessThan(240);
  const sectionTop = await page
    .locator("#category-000000000000000000000003")
    .evaluate((node) => node.getBoundingClientRect().top);
  expect(sectionTop).toBeGreaterThanOrEqual(125);
  await page.locator("#category-000000000000000000000002").scrollIntoViewIfNeeded();
  await expect(tabs.getByRole("link", { name: "قهوه سرد" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(page.getByText("ناموجود").first()).toBeVisible();
  await expect(page.getByAltText("تصویر محصول موجود نیست").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("menu headings, prices and category anchors work without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/internal/menu-preview`);
    await expect(page.getByRole("heading", { name: "آرمانی کافه" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "اسپرسو دوبل" }).first()).toBeVisible();
    await expect(page.getByText("۹۵٬۰۰۰ تومان").first()).toBeVisible();
    await page
      .getByRole("navigation", { name: "دسته‌بندی‌های منو" })
      .getByRole("link", { name: "قهوه سرد" })
      .click();
    await expect(page).toHaveURL(/#category-0{23}2$/);
  } finally {
    await context.close();
  }
});

test("live menu offers the plain server-rendered fallback without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/`);
    const plainLink = page.getByRole("link", { name: "نسخهٔ سادهٔ منو" });
    await expect(plainLink).toBeVisible();
    await plainLink.click();
    await expect(page).toHaveURL(/\/menu\/basic$/);
    await expect(page.getByRole("heading", { name: "آرمانی کافه" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("QR landing identifies a valid table and rejects malformed table parameters", async ({
  page,
}) => {
  await page.goto("/?table=3");
  await expect(page.getByText("سفارش برای میز ۳")).toBeVisible();
  await page.goto("/?table=003");
  await expect(page.getByText(/شمارهٔ میز در نشانی معتبر نیست/u)).toBeVisible();
});

test("menu preview keeps HTML and client script transfer bounded", async ({ page }) => {
  const response = await page.goto("/internal/menu-preview");
  expect(response).not.toBeNull();
  const htmlBytes = (await response!.body()).byteLength;
  const scriptBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes(".js"))
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).encodedBodySize, 0),
  );
  console.log(`Menu preview transfer: HTML ${htmlBytes} B, scripts ${scriptBytes} B`);
  expect(htmlBytes).toBeLessThan(350_000);
  expect(scriptBytes).toBeLessThan(700_000);
});
