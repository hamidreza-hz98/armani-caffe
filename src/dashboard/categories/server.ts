import "server-only";

import { cookies } from "next/headers";

import { requireDashboardActor } from "@/dashboard/server";
import { adminCookieName } from "@/modules/auth";
import { configuredCategoryService } from "@/modules/catalog/categories/server";
import { productCategoryCounts } from "@/modules/catalog/products/server";
import { getDatabaseConnection } from "@/server/database/connection";
import { getServerConfig } from "@/server/secrets/config";
import { requireAdminCapability } from "@/shared/admin-capabilities";

export async function categoryPageData() {
  const actor = requireAdminCapability(await requireDashboardActor(), "catalog.read");
  const token =
    (await cookies()).get(adminCookieName(getServerConfig().mode === "production"))?.value ?? null;
  const list = await (await configuredCategoryService()).adminList(token);
  const counts = await productCategoryCounts(
    await getDatabaseConnection(),
    list.items.map((category) => category.id),
  );
  return { actor, list, counts };
}
