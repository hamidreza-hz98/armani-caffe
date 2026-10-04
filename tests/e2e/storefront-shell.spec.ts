import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
] as const) {
  test(`storefront shell is usable at ${width}×${height} in RTL`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "آرمانی کافه" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ارتباط با ما" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ورود یا ثبت‌نام" })).toBeVisible();
    await expect(page.getByText("ورود", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "سبد خرید، ۰ کالا" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByRole("button", { name: "ارتباط با ما" }).click();
    await expect(page.getByRole("dialog", { name: "ارتباط با آرمانی کافه" })).toBeVisible();
    await page.getByRole("button", { name: "بستن پنجره ارتباط" }).click();
    await expect(page.getByRole("dialog", { name: "ارتباط با آرمانی کافه" })).toBeHidden();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("signed-in shell preview shows customer and populated cart accessibly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/internal/storefront-preview");
  await expect(page.getByRole("link", { name: "حساب سارا" })).toBeVisible();
  await expect(page.getByText("سارا", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "سبد خرید، ۳ کالا" })).toBeVisible();
  await page.getByRole("button", { name: "ارتباط با ما" }).click();
  await expect(page.getByRole("link", { name: /تماس با کافه/ })).toHaveAttribute(
    "href",
    "tel:+989121234567",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
