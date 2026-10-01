import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

const productId = "11".padStart(24, "0");
const cartId = "a".repeat(24);
const additionId = "b".repeat(24);
const item = (quantity: number, additionIds: string[] = [], note = "") => ({
  productId,
  productName: "اسپرسو دوبل",
  additions: additionIds.map((id) => ({ additionId: id, name: "شات اضافه", priceToman: 30000 })),
  quantity,
  note,
  unitPriceToman: additionIds.length ? 125000 : 95000,
  lineTotalToman: (additionIds.length ? 125000 : 95000) * quantity,
});
const cart = (quantity: number, revision: number, additionIds: string[] = [], note = "") => ({
  id: cartId,
  revision,
  items: quantity ? [item(quantity, additionIds, note)] : [],
  notes: "",
  expiresAt: "2030-01-01T00:00:00.000Z",
  pricing: {
    subtotalToman: (additionIds.length ? 125000 : 95000) * quantity,
    discountToman: 0,
    deliveryToman: 0,
    totalToman: (additionIds.length ? 125000 : 95000) * quantity,
  },
  issues: [],
  checkoutReady: quantity > 0,
  accepted: true,
});
const ok = (value: unknown) => ({ ok: true, value });

test("bottom sheet quotes additions, saves product note, and leaves menu content uncovered", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ok(cart(0, 3)) });
    const command = route.request().postDataJSON();
    expect(command).toMatchObject({
      operation: "add",
      productId,
      additionIds: [additionId],
      quantity: 2,
      note: "کم‌شیرین",
      revision: 3,
    });
    expect(command).not.toHaveProperty("totalToman");
    return route.fulfill({ json: ok(cart(2, 4, [additionId], "کم‌شیرین")) });
  });
  await page.route(`**/api/products/${productId}/options`, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: ok({
          id: productId,
          name: "اسپرسو دوبل",
          description: "قهوه تازه",
          basePriceToman: 95000,
          imageId: null,
          orderable: true,
          additions: [
            {
              id: additionId,
              name: "شات اضافه",
              priceToman: 30000,
              available: true,
              imageId: null,
            },
          ],
        }),
      });
    const selection = route.request().postDataJSON();
    const unitPriceToman = selection.additionIds.length ? 125000 : 95000;
    return route.fulfill({
      json: ok({
        productId,
        additionIds: selection.additionIds,
        quantity: selection.quantity,
        unitPriceToman,
        totalToman: unitPriceToman * selection.quantity,
      }),
    });
  });
  await page.goto("/internal/menu-preview");
  const opener = page.getByRole("button", { name: "+ افزودن" }).first();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "شخصی‌سازی سفارش" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: /شات اضافه/ }).check();
  await dialog.getByRole("button", { name: "زیاد کردن تعداد" }).click();
  await dialog.getByLabel("توضیحات برای باریستا (اختیاری)").fill("کم‌شیرین");
  await expect(dialog.getByText("۲۵۰٬۰۰۰ تومان")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "افزودن به سبد" }).click();
  await expect(dialog.getByText("به سبد خرید شما افزوده شد!")).toBeVisible();
  await dialog.getByRole("button", { name: "بازگشت به منو" }).click();
  const summary = page.getByRole("complementary", { name: "خلاصه سبد خرید" });
  await expect(summary).toContainText("۲ قلم در سبد");
  await expect(summary).toContainText("۲۵۰٬۰۰۰ تومان");
  await page.locator("#category-000000000000000000000003").scrollIntoViewIfNeeded();
  const last = page.getByRole("heading", { name: "چیزکیک سن‌سباستین" }).last();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await last.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(
    844 - 78,
  );
});

test("rapid quantity taps serialize revisions; a stale version is re-read and retried", async ({
  page,
}) => {
  let revision = 5;
  let quantity = 1;
  let conflicted = false;
  const mutations: { revision: number; quantity: number }[] = [];
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: ok(cart(quantity, revision)) });
    const command = route.request().postDataJSON();
    mutations.push({ revision: command.revision, quantity: command.quantity });
    if (!conflicted) {
      conflicted = true;
      revision = 6;
      return route.fulfill({
        json: { ok: false, error: { code: "CONFLICT", message: "نسخه سبد تغییر کرد." } },
      });
    }
    expect(command.revision).toBe(revision);
    await new Promise((resolve) => setTimeout(resolve, 120));
    quantity = command.quantity;
    revision++;
    return route.fulfill({ json: ok(cart(quantity, revision)) });
  });
  await page.goto("/internal/menu-preview");
  const plus = page.getByRole("button", { name: "زیاد کردن اسپرسو دوبل" }).first();
  await expect(plus).toBeVisible();
  await plus.click();
  await plus.click();
  await expect(page.getByRole("complementary", { name: "خلاصه سبد خرید" })).toContainText(
    "۳ قلم در سبد",
  );
  await expect.poll(() => revision).toBe(8);
  expect(mutations).toEqual([
    { revision: 5, quantity: 2 },
    { revision: 6, quantity: 2 },
    { revision: 7, quantity: 3 },
  ]);
});

test("failed mutation rolls optimistic count back to confirmed cart", async ({ page }) => {
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ok(cart(1, 2)) });
    return route.fulfill({ body: "{broken", contentType: "application/json" });
  });
  await page.goto("/internal/menu-preview");
  await expect(page.getByRole("complementary", { name: "خلاصه سبد خرید" })).toContainText(
    "۱ قلم در سبد",
  );
  await page.getByRole("button", { name: "زیاد کردن اسپرسو دوبل" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "تغییر تعداد ثبت نشد" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "خلاصه سبد خرید" })).toContainText(
    "۱ قلم در سبد",
  );
});

test("customized cart line supports note, quantity and removal", async ({ page }) => {
  let quantity = 2;
  let revision = 4;
  let note = "کم‌شیرین";
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: ok(cart(quantity, revision, [additionId], note)) });
    const command = route.request().postDataJSON();
    expect(command.revision).toBe(revision);
    if (command.operation === "remove") quantity = 0;
    else {
      quantity = command.quantity;
      note = command.note;
    }
    revision++;
    return route.fulfill({ json: ok(cart(quantity, revision, [additionId], note)) });
  });
  await page.goto("/cart");
  const line = page.getByRole("article").filter({ hasText: "اسپرسو دوبل" });
  await expect(line).toContainText("شات اضافه");
  await line.getByLabel("یادداشت این محصول").fill("بدون یخ");
  await line.getByRole("button", { name: "ثبت یادداشت" }).click();
  await expect.poll(() => note).toBe("بدون یخ");
  await line.getByRole("button", { name: "کم کردن اسپرسو دوبل" }).click();
  await expect(line.getByRole("button", { name: "حذف اسپرسو دوبل" })).toBeVisible();
  await line.getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.getByText("سبد خرید شما خالی است.", { exact: false })).toBeVisible();
});
