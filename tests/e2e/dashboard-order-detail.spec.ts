import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

declare global {
  interface Window {
    __detailPrintSocket?: { emit: (value: object) => void };
  }
}

test.skip(!process.env.E2E_ADMIN_DB, "Run with npm run test:e2e:order-detail");
test.describe.configure({ mode: "default" });
const password = "dashboard-e2e-password-12345";
let orderId: string;
let invoiceId: string;
let printId: string;
async function login(page: import("@playwright/test").Page, username = "e2e-owner") {
  await page.goto("/dashboard/login");
  await page.locator("#admin-username").fill(username);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
test.beforeAll(async () => {
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    const order = new mongoose.Types.ObjectId();
    const customer = new mongoose.Types.ObjectId();
    const transaction = new mongoose.Types.ObjectId();
    const invoice = new mongoose.Types.ObjectId();
    const print = new mongoose.Types.ObjectId();
    const inventory = new mongoose.Types.ObjectId();
    orderId = String(order);
    invoiceId = String(invoice);
    printId = String(print);
    const now = new Date();
    const pricing = {
      subtotalToman: 120000,
      discountToman: 0,
      deliveryToman: 0,
      totalToman: 120000,
    };
    const item = {
      productId: new mongoose.Types.ObjectId(),
      productName: "لاته ویژه",
      categoryName: "قهوه",
      quantity: 1,
      additions: [
        { additionId: new mongoose.Types.ObjectId(), name: "شیر بادام", priceToman: 20000 },
      ],
      note: "کم‌شیرین",
      unitPriceToman: 120000,
      lineTotalToman: 120000,
    };
    await connection.db!.collection("orders").insertOne({
      _id: order,
      code: "AC-0098001",
      customerId: customer,
      cartId: new mongoose.Types.ObjectId(),
      checkoutId: new mongoose.Types.ObjectId(),
      transactionId: transaction,
      customer: { id: String(customer), displayName: "مریم کمالی", phone: "+989123456785" },
      items: [item],
      pricing,
      transaction: { id: String(transaction), provider: "fake", reference: "REF-98001" },
      totalToman: 120000,
      notes: "داغ باشد",
      status: "NEW",
      paymentStatus: "paid",
      refundStatus: "NONE",
      placedAt: now,
      createdAt: now,
      updatedAt: now,
      __v: 0,
      idempotencyKey: "order-detail-e2e",
      snapshotVersion: 1,
    });
    await connection.db!.collection("transactions").insertOne({
      _id: transaction,
      orderId: order,
      status: "succeeded",
      issue: null,
      amountToman: 120000,
      settledAt: now,
      provider: "fake",
    });
    await connection.db!.collection("invoices").insertOne({
      _id: invoice,
      orderId: order,
      customerId: customer,
      snapshotVersion: 2,
      number: "INV-0098001",
      orderCode: "AC-0098001",
      identity: {
        title: "کافه آرمانی",
        legalName: "کافه آرمانی",
        address: "تهران",
        phone: "02100000000",
        email: "",
        footer: "سپاس از خرید شما",
      },
      customer: { displayName: "مریم کمالی", phone: "+989123456785" },
      lines: [
        {
          productName: "لاته ویژه",
          categoryName: "قهوه",
          additions: [{ name: "شیر بادام", priceToman: 20000 }],
          quantity: 1,
          note: "کم‌شیرین",
          unitPriceToman: 120000,
          lineTotalToman: 120000,
        },
      ],
      pricing,
      totalToman: 120000,
      transaction: { provider: "fake", reference: "REF-98001" },
      notes: "داغ باشد",
      issuedAt: now,
      jalaliDateTime: "۱۴۰۵/۰۷/۰۹ ۱۲:۰۰",
      paperWidthMm: 80,
      printing: { automatic: true, printerId: "test-bridge" },
      status: "issued",
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    await connection.db!.collection("print_jobs").insertOne({
      _id: print,
      invoiceId: invoice,
      orderId: order,
      source: "automatic",
      reprintId: null,
      printerId: "test-bridge",
      paperWidthMm: 80,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      leaseUntil: null,
      deliveryId: null,
      printedAt: null,
      acknowledgedAt: null,
      lastFailureCode: null,
      idempotencyKey: `invoice:auto:${invoice}`,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    await connection.db!.collection("inventory_items").insertOne({
      _id: inventory,
      name: "دانه قهوه",
      unit: "gram",
      onHand: 900,
      reorderLevel: 100,
      status: "active",
    });
    await connection.db!.collection("inventory_movements").insertOne({
      inventoryItemId: inventory,
      orderId: order,
      delta: -20,
      reason: "sale",
      before: 920,
      after: 900,
      unit: "gram",
      createdAt: now,
      idempotencyKey: "detail-stock",
    });
    await connection.db!.collection("audit_events").insertOne({
      actor: { kind: "system", id: null },
      area: "order",
      action: "order.confirmed",
      subject: { kind: "order", id: String(order) },
      occurredAt: now,
      idempotencyKey: "detail-audit",
      requestId: "detail-test",
      outcome: "success",
    });
  } finally {
    await connection.close();
  }
});
test("order, immutable invoice, stock, audit, print states, and confirmed reprint", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("WebSocket connection to", "net::ERR_FAILED");
  await login(page);
  await page.goto(`/dashboard/orders/${orderId}`);
  await expect(page.getByRole("heading", { name: /سفارش AC-0098001/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "اقلام ثبت‌شده" })).toBeVisible();
  await expect(page.getByText("شیر بادام", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("دانه قهوه")).toBeVisible();
  await expect(page.getByText("order.confirmed")).toBeVisible();
  await expect(page.getByText("INV-0098001")).toBeVisible();
  await expect(page.getByText("چاپ خودکار: در صف")).toBeVisible();
  const rejectedInquiry = await page.request.post(
    `${process.env.APP_URL}/api/admin/orders/${orderId}/verify`,
    { headers: { Origin: "https://evil.example" }, data: {} },
  );
  expect(rejectedInquiry.status()).toBe(403);
  await page.getByRole("button", { name: "استعلام معتبر تراکنش" }).click();
  await page
    .getByRole("dialog", { name: "استعلام تراکنش؟" })
    .getByRole("button", { name: "انجام استعلام" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "استعلام تراکنش انجام شد" }),
  ).toBeVisible();
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  try {
    await connection.db!.collection("print_jobs").updateOne(
      { _id: new mongoose.Types.ObjectId(printId) },
      {
        $set: {
          status: "printing",
          attempts: 1,
          leaseUntil: new Date(Date.now() + 30_000),
          deliveryId: "detail-delivery",
        },
      },
    );
    await page.getByRole("button", { name: "به‌روزرسانی" }).click();
    await expect(page.getByText("چاپ خودکار: در حال چاپ")).toBeVisible();
    await connection.db!.collection("print_jobs").updateOne(
      { _id: new mongoose.Types.ObjectId(printId) },
      {
        $set: {
          status: "queued",
          attempts: 1,
          nextAttemptAt: new Date(Date.now() + 30_000),
          lastFailureCode: "PRINTER_ERROR",
        },
      },
    );
    await page.getByRole("button", { name: "به‌روزرسانی" }).click();
    await expect(page.getByText("چاپ خودکار: در انتظار تلاش مجدد")).toBeVisible();
    await connection
      .db!.collection("print_jobs")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(printId) },
        { $set: { status: "dead", attempts: 5, nextAttemptAt: null } },
      );
    await page.getByRole("button", { name: "به‌روزرسانی" }).click();
    await expect(page.getByText("چاپ خودکار: ناموفق")).toBeVisible();
    await connection
      .db!.collection("print_jobs")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(printId) },
        { $set: { status: "printed", printedAt: new Date(), acknowledgedAt: new Date() } },
      );
    await page.getByRole("button", { name: "به‌روزرسانی" }).click();
    await expect(page.getByText("چاپ خودکار: چاپ‌شده")).toBeVisible();
    await page.getByRole("button", { name: "چاپ مجدد با تأیید" }).click();
    await page
      .getByRole("dialog", { name: "چاپ مجدد فاکتور؟" })
      .getByRole("button", { name: "ثبت چاپ مجدد" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "تلاش چاپ مجدد ثبت شد" }),
    ).toBeVisible();
    expect(
      await connection
        .db!.collection("invoices")
        .countDocuments({ orderId: new mongoose.Types.ObjectId(orderId) }),
    ).toBe(1);
    expect(
      await connection
        .db!.collection("invoice_reprints")
        .countDocuments({ orderId: new mongoose.Types.ObjectId(orderId) }),
    ).toBe(1);
    expect(
      await connection.db!.collection("audit_events").countDocuments({
        "subject.kind": "invoice",
        "subject.id": invoiceId,
        action: "invoice.reprint_requested",
      }),
    ).toBe(1);
    await page.route(`**/api/admin/orders/${orderId}/invoice/reprint`, async (route) => {
      await route.fetch(); // The server commits, but the browser loses the response.
      await route.abort();
    });
    await page.getByRole("button", { name: "چاپ مجدد با تأیید" }).click();
    await page
      .getByRole("dialog", { name: "چاپ مجدد فاکتور؟" })
      .getByRole("button", { name: "ثبت چاپ مجدد" })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: "دوباره تلاش کنید" })).toBeVisible();
    await page.unroute(`**/api/admin/orders/${orderId}/invoice/reprint`);
    await page.getByRole("button", { name: "چاپ مجدد با تأیید" }).click();
    await page
      .getByRole("dialog", { name: "چاپ مجدد فاکتور؟" })
      .getByRole("button", { name: "ثبت چاپ مجدد" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "تلاش چاپ مجدد ثبت شد" }),
    ).toBeVisible();
    expect(
      await connection
        .db!.collection("invoice_reprints")
        .countDocuments({ orderId: new mongoose.Types.ObjectId(orderId) }),
    ).toBe(2);
    await expect(page.getByRole("button", { name: "تغییر به در حال آماده‌سازی" })).toBeVisible();
    await page.getByRole("button", { name: "تغییر به در حال آماده‌سازی" }).click();
    await page
      .getByRole("dialog", { name: "تغییر وضعیت سفارش؟" })
      .getByRole("button", { name: "تغییر وضعیت" })
      .click();
    await expect(page.getByText("وضعیت سفارش به‌روز شد.")).toBeVisible();
  } finally {
    await connection.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "وضعیت چاپ" })).toBeVisible();
});

test("bridge offline and online hints are distinct from durable print status", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => {
    class FakeSocket {
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(url: string | URL) {
        if (String(url).includes("role=admin")) window.__detailPrintSocket = this;
        setTimeout(() => {
          this.onopen?.();
          if (String(url).includes("role=admin")) this.emit({ v: 1, type: "admin.ready" });
        }, 0);
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
  await page.goto(`/dashboard/orders/${orderId}`);
  await expect(page.getByText(/پل چاپ: آفلاین/u)).toBeVisible();
  await page.evaluate(() =>
    window.__detailPrintSocket?.emit({
      v: 1,
      type: "bridge.presence",
      printerId: "test-bridge",
      online: true,
    }),
  );
  await expect(page.getByText(/پل چاپ: متصل/u)).toBeVisible();
  await page.evaluate(() =>
    window.__detailPrintSocket?.emit({
      v: 1,
      type: "bridge.presence",
      printerId: "test-bridge",
      online: false,
    }),
  );
  await expect(page.getByText(/پل چاپ: آفلاین/u)).toBeVisible();
});

test("cashier can see and reprint but cannot cancel, refund, or inquire", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push("WebSocket connection to", "403");
  await login(page);
  const created = await page.evaluate(async (initialPassword) => {
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "e2e-cashier-order-detail",
        displayName: "صندوقدار سفارش",
        phone: "09123456786",
        role: "CASHIER",
        password: initialPassword,
      }),
    });
    return response.status;
  }, password);
  expect(created).toBe(200);
  await page.context().clearCookies();
  await login(page, "e2e-cashier-order-detail");
  await page.goto(`/dashboard/orders/${orderId}`);
  await expect(page.getByRole("heading", { name: /سفارش AC-0098001/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "چاپ مجدد با تأیید" })).toBeVisible();
  await expect(page.getByRole("button", { name: "استعلام معتبر تراکنش" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "لغو سفارش" })).toHaveCount(0);
  const result = await page.evaluate(async (id) => {
    const verify = await fetch(`/api/admin/orders/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const cancel = await fetch(`/api/admin/orders/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 2, status: "CANCELLED", reason: "test" }),
    });
    return { verify: verify.status, cancel: cancel.status };
  }, orderId);
  expect(result).toEqual({ verify: 403, cancel: 403 });
});
