import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

function seriousOrCritical(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
}

test("shared state gallery is keyboard operable and has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/internal/design-system");
  await page.getByRole("button", { name: "فیلترهای پیشرفته" }).click();
  const drawer = page.getByRole("dialog", { name: "فیلترهای پیشرفته" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "بستن فیلترهای پیشرفته" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "فیلترهای پیشرفته" })).toBeFocused();
  await page.getByRole("button", { name: "تأیید مخرب" }).click();
  const confirmation = page.getByRole("dialog", { name: "حذف برای همیشه؟" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "حذف برای همیشه" })).toBeDisabled();
  await confirmation.getByRole("textbox").fill("حذف");
  await expect(confirmation.getByRole("button", { name: "حذف برای همیشه" })).toBeEnabled();
  const results = await new AxeBuilder({ page }).analyze();
  expect(seriousOrCritical(results.violations)).toEqual([]);
});

test("mobile shared states remain RTL, readable, and motion-reduced", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/internal/design-system");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("navigation", { name: "صفحه‌بندی" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(seriousOrCritical(results.violations)).toEqual([]);
});

test.describe("not-found response", () => {
  test.use({
    expectedConsoleErrors: ["Failed to load resource: the server responded with a status of 404"],
  });

  test("Persian 404 state has no serious accessibility violations", async ({ page }) => {
    await page.goto("/این-صفحه-وجود-ندارد");
    await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(seriousOrCritical(results.violations)).toEqual([]);
  });
});
