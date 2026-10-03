import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

const productId = "11".padStart(24, "0");
const additionId = "b".repeat(24);
const cartId = "a".repeat(24);
const ok = (value: unknown) => ({ ok: true, value });
const emptyCart = {
  id: cartId,
  revision: 1,
  items: [],
  notes: "",
  expiresAt: "2030-01-01T00:00:00.000Z",
  pricing: { subtotalToman: 0, discountToman: 0, deliveryToman: 0, totalToman: 0 },
  issues: [],
  checkoutReady: false,
  accepted: true,
};

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, width: number) {
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(width);
  expect(sizes.body).toBeLessThanOrEqual(width);
}

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`guest browses and navigates categories without overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/customer/cart", (route) =>
      route.fulfill({
        json: { ok: false, error: { code: "UNAUTHORIZED", message: "ورود لازم است." } },
      }),
    );
    await page.goto("/internal/menu-preview");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "اسپرسو دوبل" }).first()).toBeVisible();
    const categories = page.getByRole("navigation", { name: "دسته‌بندی‌های منو" });
    await categories.getByRole("link", { name: "چای و دمنوش" }).click();
    await expect(categories.getByRole("link", { name: "چای و دمنوش" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expectNoHorizontalOverflow(page, viewport.width);
    if (viewport.width === 390) await expectNoSeriousAxeViolations(page);
  });
}

test.describe("offline recovery", () => {
  test.use({
    expectedConsoleErrors: ["ERR_INTERNET_DISCONNECTED", "WebKit encountered an internal error"],
  });

  test("slow product options recover after an offline cart write without losing the selection", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let quantity = 0;
    let offline = false;
    await page.route("**/api/customer/cart", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: ok(emptyCart) });
      if (offline) return route.abort("internetdisconnected");
      quantity = 1;
      return route.fulfill({
        json: ok({
          ...emptyCart,
          revision: 2,
          items: [
            {
              productId,
              productName: "اسپرسو دوبل",
              additions: [{ additionId, name: "شات اضافه", priceToman: 30_000 }],
              quantity,
              note: "",
              unitPriceToman: 125_000,
              lineTotalToman: 125_000,
            },
          ],
          pricing: {
            subtotalToman: 125_000,
            discountToman: 0,
            deliveryToman: 0,
            totalToman: 125_000,
          },
          checkoutReady: true,
        }),
      });
    });
    await page.route(`**/api/products/${productId}/options`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (route.request().method() === "GET")
        return route.fulfill({
          json: ok({
            id: productId,
            name: "اسپرسو دوبل",
            description: "قهوه تازه",
            basePriceToman: 95_000,
            imageId: null,
            orderable: true,
            additions: [
              {
                id: additionId,
                name: "شات اضافه",
                priceToman: 30_000,
                available: true,
                imageId: null,
              },
            ],
          }),
        });
      return route.fulfill({
        json: ok({
          productId,
          additionIds: [additionId],
          quantity: 1,
          unitPriceToman: 125_000,
          totalToman: 125_000,
        }),
      });
    });
    await page.goto("/internal/menu-preview");
    await page.getByRole("button", { name: "+ افزودن" }).first().click();
    const dialog = page.getByRole("dialog", { name: "شخصی‌سازی سفارش" });
    await expect(dialog.getByText("در حال دریافت گزینه‌ها…")).toBeVisible();
    await dialog.getByRole("checkbox", { name: /شات اضافه/ }).check();
    await expect(dialog.getByText("۱۲۵٬۰۰۰ تومان")).toBeVisible();
    offline = true;
    await context.setOffline(true);
    await dialog.getByRole("button", { name: "افزودن به سبد" }).click();
    await expect(dialog.getByRole("alert")).toContainText("افزودن به سبد انجام نشد");
    await expect(dialog.getByRole("checkbox", { name: /شات اضافه/ })).toBeChecked();
    await context.setOffline(false);
    offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const add = dialog.getByRole("button", { name: "افزودن به سبد" });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(dialog.getByText("به سبد خرید شما افزوده شد!")).toBeVisible();
    expect(quantity).toBe(1);
  });
});

for (const state of [
  { key: "success", heading: "پرداخت و سفارش ثبت شد" },
  { key: "failure", heading: "پرداخت انجام نشد" },
  { key: "pending", heading: "وضعیت پرداخت در حال بررسی است" },
]) {
  test(`payment ${state.key} state is explicit, reload-safe, and accessible`, async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto(`/internal/payment-preview?state=${state.key}`);
    await expect(page.getByRole("heading", { name: state.heading })).toBeVisible();
    await expect(page.getByRole("status")).toBeVisible();
    await expectNoHorizontalOverflow(page, 430);
    await expectNoSeriousAxeViolations(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: state.heading })).toBeVisible();
  });
}

test("guest cannot read payment or order details through a predictable identifier", async ({
  page,
}) => {
  const id = "c".repeat(24);
  await page.goto(`/payment/result/${id}`);
  await expect(page.getByRole("heading", { name: "برای مشاهده نتیجه وارد شوید" })).toBeVisible();
  await expect(page.getByText("REF-1405-0008932")).toHaveCount(0);
  await page.goto(`/orders/${id}`);
  await expect(page.getByRole("heading", { name: "برای مشاهده سفارش وارد شوید" })).toBeVisible();
  await expect(page.getByText("AC-0008932")).toHaveCount(0);
});
