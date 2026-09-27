import { describe, expect, it } from "vitest";

import { assertAdminRole } from "@/modules/admins";
import { assertCartTransition, makeCartItemSnapshot } from "@/modules/carts";
import { assertInvoiceTransition, makeInvoiceLines } from "@/modules/invoices";
import { assertMediaTransition } from "@/modules/media";
import { assertOutboxTransition } from "@/modules/notifications";
import {
  assertOrderPaymentTransition,
  assertOrderTransition,
  makeOrderItemSnapshot,
} from "@/modules/orders";
import { assertTransactionTransition } from "@/modules/payments";
import { assertPrintTransition } from "@/modules/printing";
import { asToman, asUtcTimestamp } from "@/shared/domain";
import { assertSafeRecord } from "@/shared/safe-record";

describe("domain invariants", () => {
  it("allows only OWNER and CASHIER and enforces UTC/integer Toman", () => {
    expect(() => assertAdminRole("MANAGER")).toThrow(RangeError);
    expect(() => assertAdminRole("CASHIER")).not.toThrow();
    expect(() => asToman(1.5)).toThrow(RangeError);
    expect(() => asToman(-1)).toThrow(RangeError);
    expect(() => asUtcTimestamp("2026-09-27")).toThrow();
    expect(asUtcTimestamp("2026-09-27T12:00:00.000Z")).toBe("2026-09-27T12:00:00.000Z");
  });

  it("freezes cart, order, and invoice snapshots against later catalog edits", () => {
    const source = {
      productId: "p1",
      productName: "قهوه",
      categoryName: "نوشیدنی",
      basePriceToman: 10000,
      quantity: 2,
      additions: [{ additionId: "a1", name: "شیر", priceToman: 2000 }],
    };
    const cart = makeCartItemSnapshot(source);
    const order = makeOrderItemSnapshot(source);
    const invoice = makeInvoiceLines([order]);
    source.productName = "نام جدید";
    source.additions[0].name = "افزودنی جدید";
    source.basePriceToman = 99999;
    expect(cart.productName).toBe("قهوه");
    expect(order.additions[0].name).toBe("شیر");
    expect(order.lineTotalToman).toBe(24000);
    expect(invoice[0].productName).toBe("قهوه");
    expect(Object.isFrozen(invoice[0].additions)).toBe(true);
    expect(() => makeOrderItemSnapshot({ ...source, quantity: 0 })).toThrow(RangeError);
  });

  it("rejects invalid lifecycle transitions", () => {
    expect(() => assertOrderTransition("placed", "preparing")).not.toThrow();
    expect(() => assertOrderTransition("completed", "preparing")).toThrow(RangeError);
    expect(() => assertTransactionTransition("succeeded", "pending")).toThrow(RangeError);
    expect(() => assertOrderPaymentTransition("refunded", "paid")).toThrow(RangeError);
    expect(() => assertInvoiceTransition("voided", "issued")).toThrow(RangeError);
    expect(() => assertCartTransition("checked_out", "active")).toThrow(RangeError);
    expect(() => assertMediaTransition("deleted", "ready")).toThrow(RangeError);
    expect(() => assertPrintTransition("printed", "queued")).toThrow(RangeError);
    expect(() => assertOutboxTransition("delivered", "pending")).toThrow(RangeError);
  });

  it("rejects secret and structured values in public settings/audit metadata", () => {
    expect(() => assertSafeRecord({ paymentToken: "secret" })).toThrow(RangeError);
    expect(() => assertSafeRecord({ customerPhone: "0912" })).toThrow(RangeError);
    expect(() => assertSafeRecord({ nested: { value: 1 } })).toThrow(RangeError);
    expect(() => assertSafeRecord({ displayName: "آرمانی" })).not.toThrow();
  });
});
