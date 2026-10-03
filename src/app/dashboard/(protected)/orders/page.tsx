import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { OrderManager } from "@/dashboard/orders/manager";
import { parseOrderFilters } from "@/dashboard/orders/model";
import { listOperationalOrders } from "@/dashboard/orders/server";
import { requireDashboardActor } from "@/dashboard/server";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

export const metadata: Metadata = { title: "سفارش‌ها", robots: { index: false, follow: false } };
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireDashboardActor();
  if (!adminCapabilityMap[actor.role].includes("orders.read")) forbidden();
  const filters = parseOrderFilters(await searchParams);
  const initial = await listOperationalOrders(filters);
  return (
    <OrderManager
      key={JSON.stringify(filters)}
      initial={initial}
      filters={filters}
      canManage={adminCapabilityMap[actor.role].includes("orders.manage")}
    />
  );
}
