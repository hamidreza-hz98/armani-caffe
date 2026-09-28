import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getServerConfig } from "../../../server/secrets/config.ts";
import {
  type AdminCapability,
  requireAdminCapability,
} from "../../../shared/admin-capabilities.ts";
import { adminCookieName, validAdminToken } from "../domain/admin-session.ts";

type Principal = import("../domain/admin-session.ts").AdminPrincipal;
// Resolver injection keeps Next adapters out of application code and avoids module cycles.
export async function requireAdminPage(
  capability: AdminCapability,
  resolve: (token: string | null) => Promise<Principal | null>,
) {
  const matches = (await cookies()).getAll(
    adminCookieName(getServerConfig().mode === "production"),
  );
  if (matches.length !== 1 || !validAdminToken(matches[0].value)) redirect("/admin/login");
  const actor = await resolve(matches.length === 1 ? matches[0].value : null);
  if (!actor) redirect("/admin/login");
  return requireAdminCapability(actor, capability);
}
