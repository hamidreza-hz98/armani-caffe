import { expect, test } from "../fixtures/playwright.ts";

test("login and signup OTP preview accept arbitrary entries without customer writes", async ({ page }) => {
  let authWrites = 0;
  await page.route("**/api/customer/cart", (route) =>
    route.fulfill({ json: { ok: false, error: { code: "UNAUTHORIZED", message: "guest" } } }),
  );
  await page.route("**/api/customer/auth/otp", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { preview: true } });
    return route.fulfill({ json: { ok: true, value: { preview: true, resendInSeconds: 0 } } });
  });
  await page.route(/\/api\/customer\/auth\/(login|signup)$/, (route) => {
    authWrites++;
    return route.abort();
  });
  await page.goto("/internal/menu-preview");
  await page.getByRole("button", { name: "ورود یا ثبت‌نام" }).click();
  let dialog = page.getByRole("dialog", { name: "ورود به حساب" });
  await dialog.getByLabel("شماره موبایل *").fill("preview phone");
  await dialog.getByRole("button", { name: "دریافت کد ورود" }).click();
  dialog = page.getByRole("dialog", { name: "تأیید شماره موبایل" });
  await dialog.getByLabel("کد تأیید ۶ رقمی").fill("anything");
  await dialog.getByRole("button", { name: "تأیید و ادامه" }).click();
  await expect(page.getByRole("dialog", { name: "پیش‌نمایش کامل شد" })).toBeVisible();
  await page.getByRole("button", { name: "بستن" }).last().click();

  await page.getByRole("button", { name: "ورود یا ثبت‌نام" }).click();
  dialog = page.getByRole("dialog", { name: "ورود به حساب" });
  await dialog.getByRole("button", { name: "ثبت‌نام" }).click();
  dialog = page.getByRole("dialog", { name: "عضویت در آرمانی کافه" });
  await dialog.getByRole("button", { name: "ثبت‌نام و دریافت کد" }).click();
  dialog = page.getByRole("dialog", { name: "تأیید شماره موبایل" });
  await dialog.getByRole("button", { name: "تأیید و ادامه" }).click();
  await expect(page.getByRole("dialog", { name: "پیش‌نمایش کامل شد" })).toBeVisible();
  expect(authWrites).toBe(0);
});
