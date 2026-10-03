import "server-only";

import { cookies } from "next/headers";
import { forbidden } from "next/navigation";

import { requireDashboardActor } from "@/dashboard/server";
import { adminCookieName } from "@/modules/auth";
import { configuredAdminSecurity } from "@/modules/auth/server";
import { getServerConfig } from "@/server/secrets/config";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

export type AdminPageFilters = {
  q: string;
  role: "all" | "OWNER" | "CASHIER";
  status: "all" | "active" | "disabled";
  page: number;
};
export function parseAdminPageFilters(raw: Record<string, string | undefined>): AdminPageFilters {
  return {
    q: typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "",
    role: raw.role === "OWNER" || raw.role === "CASHIER" ? raw.role : "all",
    status: raw.status === "active" || raw.status === "disabled" ? raw.status : "all",
    page: /^\d{1,5}$/.test(raw.page ?? "") && Number(raw.page) > 0 ? Number(raw.page) : 1,
  };
}
export async function adminPageData(filters: AdminPageFilters) {
  const actor = await requireDashboardActor();
  if (!adminCapabilityMap[actor.role].includes("admins.read")) forbidden();
  const token =
    (await cookies()).get(adminCookieName(getServerConfig().mode === "production"))?.value ?? null;
  const list = await (
    await configuredAdminSecurity()
  ).admins.list(token, filters.page, 20, {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.role !== "all" ? { role: filters.role } : {}),
    ...(filters.status !== "all" ? { status: filters.status } : {}),
  });
  return { actor, list };
}
