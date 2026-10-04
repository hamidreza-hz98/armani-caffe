import type { Metadata } from "next";

import type { CheckoutView, OrderView } from "@/modules/orders";
import { asToman } from "@/shared/domain";
import type { PaymentResult } from "@/storefront/payment-result";
import { PaymentResultView } from "@/storefront/payment-view";
import { privatePageMetadata } from "@/storefront/seo";

export const metadata: Metadata = { ...privatePageMetadata, title: "پیش‌نمایش نتیجه پرداخت" };

const checkoutId = "a".repeat(24);
const orderId = "c".repeat(24);
const totalToman = asToman(250_000);
const checkout: CheckoutView = {
  id: checkoutId,
  cartId: "b".repeat(24),
  state: "PAYMENT_PENDING",
  totalToman,
  recovery: null,
  orderId: null,
  revision: 3,
};
const order: OrderView = {
  id: orderId,
  code: "AC-0008932",
  customer: { id: "d".repeat(24), displayName: "سارا احمدی", phone: "+989123456789" },
  items: [
    {
      productId: "1".repeat(24),
      productName: "لاته",
      categoryName: "قهوه گرم",
      additions: [{ additionId: "2".repeat(24), name: "شات اضافه", priceToman: asToman(30_000) }],
      quantity: 2,
      note: "کم‌شیرین",
      unitPriceToman: asToman(125_000),
      lineTotalToman: totalToman,
    },
  ],
  pricing: {
    subtotalToman: totalToman,
    discountToman: 0,
    deliveryToman: 0,
    totalToman,
  },
  transaction: { id: "e".repeat(24), provider: "fake", reference: "REF-1405-0008932" },
  notes: "تحویل حضوری",
  status: "NEW",
  paymentStatus: "paid",
  refundStatus: "NONE",
  revision: 0,
  placedAt: "2026-10-03T12:00:00.000Z",
};

function result(state: string): PaymentResult {
  if (state === "success")
    return {
      checkout: { ...checkout, state: "CONFIRMED", orderId },
      payment: {
        status: "succeeded",
        issue: null,
        amountToman: totalToman,
        reference: order.transaction.reference,
        updatedAt: order.placedAt,
      },
      order,
    };
  if (state === "failure")
    return {
      checkout,
      payment: {
        status: "failed",
        issue: null,
        amountToman: totalToman,
        reference: null,
        updatedAt: order.placedAt,
      },
      order: null,
    };
  return {
    checkout,
    payment: {
      status: "pending",
      issue: "AMBIGUOUS_VERIFICATION",
      amountToman: totalToman,
      reference: null,
      updatedAt: order.placedAt,
    },
    order: null,
  };
}

export default async function PaymentPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const rawState = (await searchParams).state;
  const state = typeof rawState === "string" ? rawState : "pending";
  return <PaymentResultView result={result(state)} supportHref="tel:+982112345678" />;
}
