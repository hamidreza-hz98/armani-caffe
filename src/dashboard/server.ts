import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { adminCookieName, validAdminToken } from "@/modules/auth";
import { configuredAdminSecurity } from "@/modules/auth/server";
import { getDatabaseConnection } from "@/server/database/connection";
import { getServerConfig } from "@/server/secrets/config";
import { requireAdminCapability } from "@/shared/admin-capabilities";

import { safeDashboardDestination } from "./navigation";

export async function dashboardActor() {
  const name = adminCookieName(getServerConfig().mode === "production");
  const matches = (await cookies()).getAll(name);
  if (matches.length !== 1 || !validAdminToken(matches[0].value)) return null;
  return (await configuredAdminSecurity()).auth.resolve(matches[0].value);
}

export async function requireDashboardActor() {
  const destination = safeDashboardDestination((await headers()).get("x-armani-dashboard-path"));
  const actor = await dashboardActor();
  if (!actor) redirect(`/dashboard/login?next=${encodeURIComponent(destination)}`);
  return actor;
}

export async function searchDashboardOrder(query: string) {
  requireAdminCapability(await requireDashboardActor(), "orders.read");
  const code = query.trim().toUpperCase();
  if (!/^AC-\d{7,}$/u.test(code) || code.length > 20) return null;
  const connection = await getDatabaseConnection();
  const row = await connection
    .db!.collection<{
      code: string;
      status: string;
      pricing: { totalToman: number };
      placedAt: Date;
    }>("orders")
    .findOne(
      { code },
      { projection: { code: 1, status: 1, "pricing.totalToman": 1, placedAt: 1 }, maxTimeMS: 2500 },
    );
  return row
    ? {
        code: row.code,
        status: row.status,
        totalToman: row.pricing.totalToman,
        placedAt: row.placedAt.toISOString(),
      }
    : null;
}
