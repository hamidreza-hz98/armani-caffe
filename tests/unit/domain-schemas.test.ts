import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { adminSchema } from "@/modules/admins/server";
import { auditEventSchema } from "@/modules/audit/server";
import { stockApprovalRequestSchema } from "@/modules/inventory/server";
import { invoiceSchema } from "@/modules/invoices/server";
import { mediaAssetSchema } from "@/modules/media/server";
import { outboxEventSchema } from "@/modules/notifications/server";
import { orderSchema } from "@/modules/orders/server";
import { transactionSchema } from "@/modules/payments/server";
import { printJobSchema } from "@/modules/printing/server";
import { settingsSchema } from "@/modules/settings/server";
import { databaseIndexes } from "@/server/database/operations";

const objectId = new mongoose.Types.ObjectId();
const Admin = mongoose.model("DomainAdminTest", adminSchema);
const Order = mongoose.model("DomainOrderTest", orderSchema);
const Invoice = mongoose.model("DomainInvoiceTest", invoiceSchema);
const Settings = mongoose.model("DomainSettingsTest", settingsSchema);
const Audit = mongoose.model("DomainAuditTest", auditEventSchema);
const Media = mongoose.model("DomainMediaTest", mediaAssetSchema);
const Transaction = mongoose.model("DomainTransactionTest", transactionSchema);
const Print = mongoose.model("DomainPrintTest", printJobSchema);
const StockApproval = mongoose.model("DomainStockApprovalTest", stockApprovalRequestSchema);
const Outbox = mongoose.model("DomainOutboxTest", outboxEventSchema);

const item = {
  productId: objectId,
  productName: "قهوه",
  categoryName: "نوشیدنی",
  additions: [],
  quantity: 2,
  unitPriceToman: 10000,
  lineTotalToman: 20000,
};

describe("Mongoose domain schema defenses", () => {
  it("rejects extra admin roles and normalizes phone", async () => {
    const admin = new Admin({
      phone: "09123456789",
      displayName: "مالک",
      passwordHash: "hash",
      role: "OWNER",
    });
    await expect(admin.validate()).resolves.toBeUndefined();
    expect(admin.phone).toBe("+989123456789");
    await expect(
      new Admin({
        phone: "09123456789",
        displayName: "مدیر",
        passwordHash: "hash",
        role: "MANAGER",
      }).validate(),
    ).rejects.toThrow();
  });

  it("rejects invalid order and invoice totals and non-integer Toman", async () => {
    const order = {
      code: "AC-0000001",
      items: [item],
      totalToman: 20000,
      idempotencyKey: "idem-1",
      placedAt: new Date(),
    };
    await expect(new Order(order).validate()).resolves.toBeUndefined();
    await expect(new Order({ ...order, totalToman: 19999 }).validate()).rejects.toThrow();
    await expect(new Order({ ...order, totalToman: 20000.5 }).validate()).rejects.toThrow();
    await expect(
      new Invoice({
        orderId: objectId,
        number: "INV-1",
        lines: [
          {
            productName: item.productName,
            categoryName: item.categoryName,
            additions: [],
            quantity: 2,
            unitPriceToman: 10000,
            lineTotalToman: 20000,
          },
        ],
        totalToman: 20000,
        issuedAt: new Date(),
      }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new Invoice({
        orderId: objectId,
        number: "INV-2",
        lines: [
          {
            productName: "قهوه",
            categoryName: "نوشیدنی",
            additions: [],
            quantity: 1,
            unitPriceToman: 10000,
            lineTotalToman: 10000,
          },
        ],
        totalToman: 10000,
        issuedAt: new Date(),
        status: "voided",
      }).validate(),
    ).rejects.toThrow();
  });

  it("blocks secrets in settings and audit metadata", async () => {
    await expect(
      new Settings({ kind: "business", revision: 1, values: { title: "کافه" } }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new Settings({ kind: "payment", revision: 1, values: { apiKey: "secret" } }).validate(),
    ).rejects.toThrow();
    const event = {
      occurredAt: new Date(),
      actor: { kind: "system" },
      action: "seed",
      subject: { kind: "settings", id: "1" },
      requestId: "test",
      area: "settings",
      idempotencyKey: "audit-schema-test",
      outcome: "success",
    };
    await expect(
      new Audit({ ...event, metadata: { result: "ok" } }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new Audit({ ...event, metadata: { password: "secret" } }).validate(),
    ).rejects.toThrow();
  });

  it("requires timestamps and actors for terminal workflow states", async () => {
    const media = {
      filename: "test.jpg",
      objectVersion: "00000000-0000-4000-8000-000000000001",
      title: "رسانه",
      uploaderId: objectId,
      initiationKey: "test-initiation",
      fingerprint: "b".repeat(64),
      ticketCiphertext: "encrypted-test-ticket",
      stagingKey: "staging/test",
      expiresAt: new Date(),
      objectKey: "media/one",
      bucket: "media",
      mimeType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
      ownerId: objectId,
      status: "deleted",
    };
    await expect(new Media(media).validate()).rejects.toThrow();
    await expect(
      new Media({ ...media, deletedAt: new Date() }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new Transaction({
        orderId: objectId,
        provider: "test",
        amountToman: 10,
        status: "succeeded",
        idempotencyKey: "t-1",
      }).validate(),
    ).rejects.toThrow();
    await expect(
      new Print({
        orderId: objectId,
        printerId: "bridge",
        status: "printed",
        attempts: 1,
        idempotencyKey: "p-1",
      }).validate(),
    ).rejects.toThrow();
    await expect(
      new StockApproval({
        inventoryItemId: objectId,
        requestedDelta: 1,
        reason: "count",
        requestedBy: objectId,
        status: "approved",
      }).validate(),
    ).rejects.toThrow();
    await expect(
      new Outbox({
        aggregateKind: "order",
        aggregateId: "1",
        eventType: "placed",
        payload: { orderId: "1" },
        requestId: "test",
        actor: { kind: "system" },
        status: "processing",
        attempts: 1,
        maxAttempts: 8,
        availableAt: new Date(),
        idempotencyKey: "o-1",
      }).validate(),
    ).rejects.toThrow();
  });

  it("declares named unique, search, status, and outbox claim indexes without connecting", () => {
    const names = new Set(databaseIndexes.map((index) => index.name));
    for (const name of [
      "admin_phone_unique",
      "product_text_search",
      "order_status_placed",
      "order_idempotency_unique",
      "invoice_number_unique",
      "outbox_claim",
    ])
      expect(names.has(name)).toBe(true);
    expect(databaseIndexes.length).toBeGreaterThan(45);
    expect(orderSchema.path("items").options.immutable).toBe(true);
    expect(invoiceSchema.path("lines").options.immutable).toBe(true);
    expect(mongoose.connection.readyState).toBe(0);
  });
});
