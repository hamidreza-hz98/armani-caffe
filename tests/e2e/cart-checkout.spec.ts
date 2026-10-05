import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

const productId = "1".padStart(24, "0");
const additionId = "2".padStart(24, "0");
const cartId = "a".repeat(24);
const ok = (value: unknown) => ({ ok: true, value });
const fail = (code: string) => ({ ok: false, error: { code, message: "safe error" } });
function cart(revision = 3, price = 125000, issues: unknown[] = [], notes = "", quantity = 2) {
  return {
    id: cartId,
    revision,
    items: quantity
      ? [
          {
            productId,
            productName: "لاته",
            additions: [{ additionId, name: "شات اضافه", priceToman: 30000 }],
            quantity,
            note: "",
            unitPriceToman: price,
            lineTotalToman: price * quantity,
          },
        ]
      : [],
    notes,
    expiresAt: "2030-01-01T00:00:00.000Z",
    pricing: {
      subtotalToman: price * quantity,
      discountToman: 0,
      deliveryToman: 0,
      totalToman: price * quantity,
    },
    issues,
    checkoutReady: quantity > 0 && issues.length === 0,
    accepted: true,
  };
}

test("a scanned QR table is synchronized to the cart before checkout", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("armani.table", "3"));
  let current = { ...cart(), tableNumber: null as number | null };
  let tableWrites = 0;
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ok(current) });
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ operation: "table", tableNumber: 3, cartId });
    tableWrites++;
    current = { ...current, revision: current.revision + 1, tableNumber: 3 };
    return route.fulfill({ json: ok(current) });
  });
  await page.goto("/cart");
  await expect(page.getByText("شمارهٔ میز: ۳")).toBeVisible();
  await page.reload();
  await expect(page.getByText("شمارهٔ میز: ۳")).toBeVisible();
  expect(tableWrites).toBe(1);
});

test("mobile pickup cart saves notes, uses server total, and initiates payment once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let current = cart();
  let previews = 0;
  let checkouts = 0;
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ok(current) });
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty("totalToman");
    if (body.operation === "notes") {
      expect(body.notes).toContain("تحویل حضوری: حدود ۳۰ دقیقه");
      expect(body.notes).toContain("توضیحات سفارش: کمی دیر می‌رسم");
      current = { ...current, revision: current.revision + 1, notes: body.notes };
    }
    return route.fulfill({ json: ok(current) });
  });
  await page.route("**/api/customer/cart/preview", async (route) => {
    previews++;
    expect(route.request().postDataJSON()).toEqual({ cartId, revision: current.revision });
    current = { ...current, revision: current.revision + 1 };
    return route.fulfill({ json: ok(current) });
  });
  await page.route("**/api/checkout", async (route) => {
    checkouts++;
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      cartId,
      revision: current.revision,
      idempotencyKey: `cart_${cartId}_${current.revision}`,
    });
    expect(body).not.toHaveProperty("totalToman");
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      json: ok({
        checkout: { id: "b".repeat(24), state: "PAYMENT_PENDING", totalToman: 250000 },
        payment: {
          amountToman: 250000,
          status: "pending",
          redirectUrl: "https://gateway.example.test/pay",
        },
      }),
    });
  });
  await page.route("https://gateway.example.test/pay", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>Sandbox gateway</h1>" }),
  );
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "سبد خرید" })).toBeVisible();
  await expect(page.getByRole("article")).toContainText("شات اضافه");
  await expect(page.getByRole("img", { name: "تصویر محصول موجود نیست" })).toBeVisible();
  await expect(page.getByText("۲۵۰٬۰۰۰ تومان").last()).toBeVisible();
  await page.getByRole("radio", { name: "حدود ۳۰ دقیقه پس از ثبت سفارش" }).check();
  await page.getByLabel("یادداشت برای کافه (اختیاری)").fill("کمی دیر می‌رسم");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const pay = page.getByRole("button", { name: "ثبت سفارش و ادامه پرداخت" });
  await pay.dblclick();
  await expect(page.getByRole("heading", { name: "Sandbox gateway" })).toBeVisible();
  expect(previews).toBe(1);
  expect(checkouts).toBe(1);
});

test("price change and unavailable item block checkout until reconciled or removed", async ({
  page,
}) => {
  let current = cart(3, 95000);
  let previews = 0;
  let checkouts = 0;
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ok(current) });
    const body = route.request().postDataJSON();
    if (body.operation === "remove")
      current = cart(current.revision + 1, 125000, [], current.notes, 0);
    else if (body.operation === "notes")
      current = { ...current, revision: current.revision + 1, notes: body.notes };
    return route.fulfill({ json: ok(current) });
  });
  await page.route("**/api/customer/cart/preview", async (route) => {
    previews++;
    current =
      previews === 1
        ? cart(
            current.revision + 1,
            125000,
            [
              {
                code: "PRICE_CHANGED",
                itemKey: `${productId}:${additionId}`,
                previousUnitPriceToman: 95000,
                currentUnitPriceToman: 125000,
              },
            ],
            current.notes,
          )
        : previews === 2
          ? cart(current.revision + 1, 125000, [], current.notes)
          : cart(
              current.revision + 1,
              125000,
              [{ code: "PRODUCT_UNAVAILABLE", itemKey: `${productId}:${additionId}` }],
              current.notes,
            );
    return route.fulfill({ json: ok(current) });
  });
  await page.route("**/api/checkout", (route) => {
    checkouts++;
    return route.fulfill({ json: fail("UNAVAILABLE") });
  });
  await page.goto("/cart");
  await page.getByRole("button", { name: "ثبت سفارش و ادامه پرداخت" }).click();
  await expect(page.getByText("قیمت‌ها به‌روز شده‌اند")).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت سفارش و ادامه پرداخت" })).toBeDisabled();
  expect(checkouts).toBe(0);
  await page.getByRole("button", { name: "بررسی مجدد قیمت و موجودی" }).click();
  await expect(page.getByRole("button", { name: "ثبت سفارش و ادامه پرداخت" })).toBeEnabled();
  await page.getByRole("button", { name: "بررسی مجدد قیمت و موجودی" }).click();
  await expect(page.getByText("برخی اقلام نیاز به اصلاح دارند")).toBeVisible();
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "حذف لاته از سبد" });
  await confirmation.getByRole("button", { name: "انصراف و حفظ آیتم" }).click();
  await expect(page.getByRole("article")).toBeVisible();
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  await confirmation.getByRole("button", { name: "بله، حذف از سبد" }).click();
  await expect(page.getByRole("heading", { name: "سبد خرید شما خالی است" })).toBeVisible();
});

test("failed payment retries the same checkout key without another preview", async ({ page }) => {
  let current = cart();
  let previews = 0;
  const keys: string[] = [];
  await page.route("**/api/customer/cart", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ok(current) });
    const body = route.request().postDataJSON();
    current = { ...current, revision: current.revision + 1, notes: body.notes };
    return route.fulfill({ json: ok(current) });
  });
  await page.route("**/api/customer/cart/preview", async (route) => {
    previews++;
    current = { ...current, revision: current.revision + 1 };
    return route.fulfill({ json: ok(current) });
  });
  await page.route("**/api/checkout", async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    return route.fulfill({ json: fail("UNAVAILABLE") });
  });
  await page.goto("/cart");
  const pay = page.getByRole("button", { name: "ثبت سفارش و ادامه پرداخت" });
  await pay.click();
  await expect(page.getByText("شروع پرداخت انجام نشد.", { exact: false })).toBeVisible();
  await pay.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(new Set(keys).size).toBe(1);
  expect(previews).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "سبد خرید" })).toBeVisible();
  await expect(page.getByRole("article")).toBeVisible();
});

test("guest is prompted to authenticate and an empty cart returns to the menu", async ({
  page,
}) => {
  await page.route("**/api/customer/cart", (route) =>
    route.fulfill({ json: fail("UNAUTHORIZED") }),
  );
  await page.goto("/cart");
  await page.getByRole("button", { name: "ورود یا ثبت‌نام" }).last().click();
  await expect(page.getByRole("dialog", { name: "ورود به حساب" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.unroute("**/api/customer/cart");
  await page.route("**/api/customer/cart", (route) =>
    route.fulfill({ json: ok(cart(1, 125000, [], "", 0)) }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "سبد خرید شما خالی است" })).toBeVisible();
  await expect(page.getByRole("link", { name: "بازگشت به منو" })).toHaveAttribute("href", "/");
});
