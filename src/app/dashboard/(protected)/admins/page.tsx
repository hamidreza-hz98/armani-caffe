import type { Metadata } from "next";

import { AdminManager } from "@/dashboard/admins/manager";
import { adminPageData, parseAdminPageFilters } from "@/dashboard/admins/server";

export const metadata: Metadata = {
  title: "مدیران و دسترسی‌ها",
  robots: { index: false, follow: false },
};

export default async function AdminsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const filters = parseAdminPageFilters(await searchParams);
  const { actor, list } = await adminPageData(filters);
  return (
    <AdminManager
      key={`${filters.q}:${filters.role}:${filters.status}:${filters.page}`}
      initial={list}
      filters={filters}
      actorId={actor.id}
    />
  );
}
