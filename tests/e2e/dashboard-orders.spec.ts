import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

declare global {
  interface Window {
    __ordersSocket?: { emit: (value: object) => void; close: () => void };
  }
}

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:orders");
test.describe.configure({ mode: "default" });
const password = "dashboard-e2e-password-12345";
async function login(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill("e2e-owner");
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
test("order list separates statuses, filters, and advances a selected order", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("WebSocket connection to");
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    const placedAt = new Date();
    await connection.db!.collection("orders").insertMany([
      {
        code: "AC-0097001",
        customerId: new mongoose.Types.ObjectId(),
        cartId: new mongoose.Types.ObjectId(),
        checkoutId: new mongoose.Types.ObjectId(),
        transactionId: new mongoose.Types.ObjectId(),
        customer: {
          id: new mongoose.Types.ObjectId().toString(),
          displayName: "مشتری سفارش",
          phone: "+989123456780",
        },
        items: [
          {
            productId: new mongoose.Types.ObjectId(),
            productName: "لاته",
            categoryName: "قهوه",
            quantity: 1,
            additions: [],
            note: "",
            unitPriceToman: 120000,
            lineTotalToman: 120000,
          },
        ],
        pricing: { subtotalToman: 120000, discountToman: 0, deliveryToman: 0, totalToman: 120000 },
        transaction: {
          id: new mongoose.Types.ObjectId().toString(),
          provider: "fake",
          reference: "ORDER-E2E-1",
        },
        totalToman: 120000,
        notes: "",
        status: "NEW",
        paymentStatus: "paid",
        refundStatus: "NONE",
        placedAt,
        createdAt: placedAt,
        updatedAt: placedAt,
        __v: 0,
        idempotencyKey: "orders-page-1",
        snapshotVersion: 1,
      },
      {
        code: "AC-0097002",
        customerId: new mongoose.Types.ObjectId(),
        customer: { displayName: "مشتری دوم", phone: "+989123456781" },
        items: [{ productName: "اسپرسو", quantity: 1 }],
        totalToman: 90000,
        status: "COMPLETED",
        paymentStatus: "refunded",
        placedAt,
        __v: 0,
        idempotencyKey: "orders-page-2",
      },
    ]);
  } finally {
    await connection.close();
  }
  await login(page);
  await page.goto("/dashboard/orders");
  await expect(page.getByRole("heading", { name: "سفارش‌ها", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("AC-0097001");
  await expect(page.getByRole("table")).toContainText("بازگشت وجه");
  await page.getByRole("button", { name: "جدید و پرداخت‌شده" }).click();
  await expect(page).toHaveURL(/status=NEW/u);
  await expect(page.getByRole("table")).toContainText("AC-0097001");
  await expect(page.getByRole("table")).not.toContainText("AC-0097002");
  await page
    .getByRole("row", { name: /AC-0097001/u })
    .getByRole("button", { name: "مرحله بعد" })
    .click();
  await page
    .getByRole("dialog", { name: "تغییر وضعیت سفارش‌ها؟" })
    .getByRole("button", { name: "تغییر وضعیت" })
    .click();
  await page.goto("/dashboard/orders");
  await expect(page.getByRole("table")).toContainText("در حال آماده‌سازی");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/orders");
  await expect(page.locator("article").filter({ hasText: "AC-0097001" })).toBeVisible();
});

test("duplicate notices reconcile once and reconnect catches missed orders", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => {
    class FakeSocket {
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        window.__ordersSocket = this;
        setTimeout(() => this.onopen?.(), 0);
      }
      emit(value: object) {
        this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
      }
      close() {
        this.onclose?.();
      }
    }
    Object.defineProperty(window, "WebSocket", { value: FakeSocket });
  });
  await page.goto("/dashboard/orders");
  await expect(page.getByRole("status").filter({ hasText: "اتصال زنده برقرار است" })).toBeVisible();
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    const firstId = new mongoose.Types.ObjectId();
    await connection.db!.collection("orders").insertOne({
      _id: firstId,
      code: "AC-0097003",
      customer: { displayName: "مشتری زنده", phone: "+989123456782" },
      items: [{ productName: "موکا", quantity: 1 }],
      totalToman: 110000,
      status: "NEW",
      paymentStatus: "paid",
      placedAt: new Date(),
      __v: 0,
      idempotencyKey: "orders-page-3",
    });
    const notice = {
      v: 1,
      type: "order.changed",
      eventId: new mongoose.Types.ObjectId().toString(),
      orderId: firstId.toString(),
      change: "order.confirmed",
      at: new Date().toISOString(),
    };
    await page.evaluate((value) => {
      window.__ordersSocket?.emit(value);
      window.__ordersSocket?.emit(value);
    }, notice);
    await expect(page.getByRole("table").getByText("AC-0097003")).toHaveCount(1);
    await page.evaluate(() => window.__ordersSocket?.close());
    await connection.db!.collection("orders").insertOne({
      code: "AC-0097004",
      customer: { displayName: "مشتری آفلاین", phone: "+989123456783" },
      items: [{ productName: "چای", quantity: 1 }],
      totalToman: 60000,
      status: "NEW",
      paymentStatus: "paid",
      placedAt: new Date(),
      __v: 0,
      idempotencyKey: "orders-page-4",
    });
    await expect(page.getByRole("table").getByText("AC-0097004")).toHaveCount(1);
  } finally {
    await connection.close();
  }
});
