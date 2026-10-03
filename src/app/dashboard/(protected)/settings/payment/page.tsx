import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { PaymentSettingsManager } from "@/dashboard/payment/manager";
import { paymentSettingsData } from "@/dashboard/payment/server";
import { requireDashboardActor } from "@/dashboard/server";

export const metadata: Metadata = {
  title: "درگاه‌های پرداخت",
  robots: { index: false, follow: false },
};
export default async function PaymentSettingsPage() {
  const actor = await requireDashboardActor();
  if (actor.role !== "OWNER") forbidden();
  return <PaymentSettingsManager initial={await paymentSettingsData(actor)} />;
}
