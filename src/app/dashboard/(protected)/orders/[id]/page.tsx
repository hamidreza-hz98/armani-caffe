import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";

import { OrderDetail } from "@/dashboard/orders/detail";
import { orderDetailData } from "@/dashboard/orders/detail-server";
import { dashboardAdminToken, requireDashboardActor } from "@/dashboard/server";
import { adminCapabilityMap } from "@/shared/admin-capabilities";
import { ApplicationError } from "@/shared/errors";

export const metadata: Metadata = {
  title: "جزئیات سفارش",
  robots: { index: false, follow: false },
};
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDashboardActor();
  if (!adminCapabilityMap[actor.role].includes("orders.read")) forbidden();
  const { id } = await params;
  if (!/^[a-f\d]{24}$/u.test(id)) notFound();
  const token = await dashboardAdminToken();
  let initial;
  try {
    initial = await orderDetailData(token, id);
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <OrderDetail
      initial={initial}
      canManage={adminCapabilityMap[actor.role].includes("orders.manage")}
      isOwner={actor.role === "OWNER"}
      canReprint={adminCapabilityMap[actor.role].includes("invoices.reprint")}
    />
  );
}
