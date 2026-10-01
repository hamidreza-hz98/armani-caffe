import type { CheckoutView, OrderView } from "@/modules/orders";
import type { PaymentIssue } from "@/modules/payments";

export type CustomerPayment = {
  status: "created" | "pending" | "succeeded" | "failed" | "refunded";
  issue: PaymentIssue;
  amountToman: number;
  reference: string | null;
  updatedAt: string;
};

export type PaymentResult = {
  checkout: CheckoutView;
  payment: CustomerPayment | null;
  order: OrderView | null;
};

/** A verified payment is not a completed order until fulfillment commits. */
export function paymentResultState(result: PaymentResult): "success" | "failure" | "pending" {
  if (
    result.checkout.state === "CONFIRMED" &&
    result.payment?.status === "succeeded" &&
    result.order?.paymentStatus === "paid" &&
    result.order.id === result.checkout.orderId &&
    result.order.pricing.totalToman === result.checkout.totalToman &&
    result.payment.amountToman === result.checkout.totalToman &&
    result.order.transaction.reference === result.payment.reference
  )
    return "success";
  if (result.payment?.status === "failed" && result.checkout.state === "PAYMENT_PENDING")
    return "failure";
  return "pending";
}
