import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

const ok = (value: unknown) => ({ ok: true, value });
const fail = (code: string) => ({ ok: false, error: { code, message: "safe error" } });

test("RTL login sheet validates, handles invalid credentials and throttling, then closes on login", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let attempts = 0;
  await page.route("**/api/customer/cart", (route) =>
    route.fulfill({ json: fail("UNAUTHORIZED") }),
  );
  await page.route("**/api/customer/auth/login", async (route) => {
    attempts++;
    if (attempts === 1) return route.fulfill({ json: fail("INVALID_CREDENTIALS") });
    if (attempts === 2) return route.fulfill({ json: fail("RATE_LIMITED") });
    return route.fulfill({ json: ok({ id: "a".repeat(24) }) });
  });
  await page.goto("/internal/menu-preview");
  await page.getByRole("button", { name: "ورود یا ثبت‌نام" }).click();
  const dialog = page.getByRole("dialog", { name: "ورود به حساب" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("شماره موبایل *")).toBeFocused();
  await dialog.getByRole("button", { name: "ورود به حساب کاربری" }).click();
  await expect(dialog.getByText("شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود.")).toBeVisible();
  await dialog.getByLabel("شماره موبایل *").fill("۰۹۱۲۳۴۵۶۷۸۹");
  await dialog.getByLabel("رمز عبور *").fill("wrong-password");
  await dialog.getByRole("button", { name: "نمایش رمز عبور" }).click();
  await expect(dialog.getByLabel("رمز عبور *")).toHaveAttribute("type", "text");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "ورود به حساب کاربری" }).click();
  await expect(dialog.getByText("شماره موبایل یا رمز عبور درست نیست.")).toBeVisible();
  await dialog.getByRole("button", { name: "ورود به حساب کاربری" }).click();
  await expect(dialog.getByText("تلاش‌های زیادی انجام شده است.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "ورود به حساب کاربری" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test("signup uses Jalali date, reports duplicate mobile and server failure, then logs in", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/customer/cart", (route) =>
    route.fulfill({ json: fail("UNAUTHORIZED") }),
  );
  let signupAttempts = 0;
  await page.route("**/api/customer/auth/signup", async (route) => {
    requests.push(route.request().postDataJSON());
    signupAttempts++;
    if (signupAttempts === 1) return route.fulfill({ json: fail("CONFLICT") });
    if (signupAttempts === 2)
      return route.fulfill({ body: "broken", contentType: "application/json" });
    return route.fulfill({ json: ok({ id: "a".repeat(24) }) });
  });
  await page.route("**/api/customer/auth/login", (route) =>
    route.fulfill({ json: ok({ id: "a".repeat(24) }) }),
  );
  await page.goto("/internal/menu-preview");
  await page.getByRole("button", { name: "ورود یا ثبت‌نام" }).click();
  const dialog = page.locator('dialog[aria-labelledby="customer-auth-title"]');
  await dialog.getByRole("button", { name: "ثبت‌نام" }).click();
  await expect(dialog).toHaveAttribute("dir", "rtl");
  await dialog.getByLabel("نام *").fill("سارا احمدی");
  await dialog.getByLabel("شماره موبایل *").fill("۰۹۱۲۳۴۵۶۷۸۹");
  await dialog.getByLabel("روز تولد").selectOption("1");
  await dialog.getByLabel("ماه تولد").selectOption("1");
  await dialog.getByLabel("سال تولد").selectOption("1400");
  await dialog.getByLabel("رمز عبور *").fill("a-secure-password-123");
  await dialog.getByRole("button", { name: "ساخت حساب کاربری" }).click();
  await expect(dialog.getByText("این شماره موبایل قبلاً ثبت شده است.").first()).toBeVisible();
  await dialog.getByRole("button", { name: "ساخت حساب کاربری" }).click();
  await expect(dialog.getByText("پاسخ سرور دریافت نشد.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "ساخت حساب کاربری" }).click();
  await expect(dialog).toBeHidden();
  expect(requests[0]).toMatchObject({
    phone: "+989123456789",
    birthDate: "2021-03-21",
    displayName: "سارا احمدی",
  });
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("logout invokes separate customer endpoint without storing credentials", async ({ page }) => {
  let loggedOut = false;
  await page.route("**/api/customer/auth/logout", async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    loggedOut = true;
    await route.fulfill({ json: ok({ loggedOut: true }) });
  });
  await page.goto("/internal/storefront-preview");
  await page.getByRole("button", { name: "خروج از حساب" }).click();
  await expect.poll(() => loggedOut).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test("guest resumes the chosen menu item after authentication", async ({ page }) => {
  const productId = "11".padStart(24, "0");
  let authenticated = false;
  let added = false;
  const emptyCart = {
    id: "a".repeat(24),
    revision: 1,
    items: [],
    notes: "",
    expiresAt: "2030-01-01T00:00:00.000Z",
    pricing: { subtotalToman: 0, discountToman: 0, deliveryToman: 0, totalToman: 0 },
    issues: [],
    checkoutReady: false,
    accepted: true,
  };
  await page.route("**/api/customer/cart", async (route) => {
    if (!authenticated) return route.fulfill({ json: fail("UNAUTHORIZED") });
    if (route.request().method() === "GET") return route.fulfill({ json: ok(emptyCart) });
    expect(route.request().postDataJSON()).toMatchObject({
      operation: "add",
      productId,
      quantity: 1,
    });
    added = true;
    return route.fulfill({
      json: ok({
        ...emptyCart,
        revision: 2,
        items: [
          {
            productId,
            productName: "اسپرسو دوبل",
            additions: [],
            quantity: 1,
            note: "",
            unitPriceToman: 95000,
            lineTotalToman: 95000,
          },
        ],
        pricing: { subtotalToman: 95000, discountToman: 0, deliveryToman: 0, totalToman: 95000 },
        checkoutReady: true,
      }),
    });
  });
  await page.route(`**/api/products/${productId}/options`, async (route) =>
    route.fulfill({
      json: ok(
        route.request().method() === "GET"
          ? {
              id: productId,
              name: "اسپرسو دوبل",
              description: "",
              basePriceToman: 95000,
              imageId: null,
              orderable: true,
              additions: [],
            }
          : { productId, additionIds: [], quantity: 1, unitPriceToman: 95000, totalToman: 95000 },
      ),
    }),
  );
  await page.route("**/api/customer/auth/login", async (route) => {
    authenticated = true;
    await route.fulfill({ json: ok({ id: "a".repeat(24) }) });
  });
  await page.goto("/internal/menu-preview");
  await page.getByRole("button", { name: "افزودن", exact: true }).first().click();
  const options = page.getByRole("dialog", { name: "شخصی‌سازی سفارش" });
  await expect(options.getByText("۹۵٬۰۰۰ تومان", { exact: true })).toBeVisible();
  await options.getByRole("button", { name: "ورود و افزودن به سبد" }).click();
  const auth = page.getByRole("dialog", { name: "ورود به حساب" });
  await auth.getByLabel("شماره موبایل *").fill("09123456789");
  await auth.getByLabel("رمز عبور *").fill("a-secure-password-123");
  await auth.getByRole("button", { name: "ورود به حساب کاربری" }).click();
  await expect.poll(() => added).toBe(true);
  await expect(options.getByText("به سبد خرید شما افزوده شد!")).toBeVisible();
});
