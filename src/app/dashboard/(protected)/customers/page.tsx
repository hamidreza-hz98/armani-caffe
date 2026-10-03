import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { CustomerManager } from "@/dashboard/customers/manager";
import { listCustomers, parseCustomerFilters } from "@/dashboard/customers/server";
import { requireDashboardActor } from "@/dashboard/server";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

export const metadata: Metadata = { title: "مشتریان", robots: { index: false, follow: false } };
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireDashboardActor();
  if (!adminCapabilityMap[actor.role].includes("customers.read")) forbidden();
  const filters = parseCustomerFilters(await searchParams);
  const initial = await listCustomers(filters);
  return (
    <CustomerManager
      key={`${filters.q}:${filters.status}:${filters.page}`}
      initial={initial}
      filters={filters}
      editable={adminCapabilityMap[actor.role].includes("customers.manage")}
    />
  );
}
