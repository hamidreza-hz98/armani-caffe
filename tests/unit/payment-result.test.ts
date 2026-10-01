import { expect, test } from "vitest";

import type { CheckoutView, OrderView } from "@/modules/orders";
import { type PaymentResult, paymentResultState } from "@/storefront/payment-result";

const checkout: CheckoutView = {
  id: "a".repeat(24),
  cartId: "b".repeat(24),
  state: "PAYMENT_PENDING",
  totalToman: 120000,
  recovery: null,
  orderId: null,
  revision: 1,
};
const payment: NonNullable<PaymentResult["payment"]> = {
  status: "pending",
  issue: "AWAITING_PAYMENT",
  amountToman: 120000,
  reference: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const order = {
  id: checkout.id,
  paymentStatus: "paid",
  pricing: { totalToman: checkout.totalToman },
  transaction: { reference: "verified-reference" },
} as OrderView;

test("only a confirmed, paid order can show success", () => {
  expect(
    paymentResultState({ checkout, payment: { ...payment, status: "succeeded" }, order: null }),
  ).toBe("pending");
  expect(
    paymentResultState({
      checkout: { ...checkout, state: "RECOVERY_REQUIRED" },
      payment: { ...payment, status: "succeeded", reference: "verified-reference" },
      order: null,
    }),
  ).toBe("pending");
  expect(
    paymentResultState({ checkout: { ...checkout, state: "CONFIRMED" }, payment, order }),
  ).toBe("pending");
  expect(
    paymentResultState({
      checkout: { ...checkout, state: "CONFIRMED", orderId: checkout.id },
      payment: { ...payment, status: "succeeded", reference: "verified-reference" },
      order,
    }),
  ).toBe("success");
});

test("failed payments are distinct from timeout, mismatch and delayed verification", () => {
  expect(
    paymentResultState({ checkout, payment: { ...payment, status: "failed" }, order: null }),
  ).toBe("failure");
  for (const issue of [
    "AMOUNT_MISMATCH",
    "AUTHORITY_MISMATCH",
    "AMBIGUOUS_VERIFICATION",
    "AWAITING_PAYMENT",
  ] as const)
    expect(paymentResultState({ checkout, payment: { ...payment, issue }, order: null })).toBe(
      "pending",
    );
});
