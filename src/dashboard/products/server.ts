import "server-only";

import { cookies } from "next/headers";
import { forbidden } from "next/navigation";

import { requireDashboardActor } from "@/dashboard/server";
import { adminCookieName } from "@/modules/auth";
import { configuredCategoryService } from "@/modules/catalog/categories/server";
import type { ProductListQuery } from "@/modules/catalog/products";
import { configuredInventoryService } from "@/modules/inventory/server";
import { configuredProductService } from "@/server/catalog/products";
import { getServerConfig } from "@/server/secrets/config";
import { requireAdminCapability } from "@/shared/admin-capabilities";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

async function context() {
  const actor = requireAdminCapability(await requireDashboardActor(), "catalog.read");
  const token =
    (await cookies()).get(adminCookieName(getServerConfig().mode === "production"))?.value ?? null;
  return { actor, token };
}

export async function productListData(query: ProductListQuery) {
  const { actor, token } = await context();
  const [products, categories] = await Promise.all([
    (await configuredProductService()).listPage(token, query),
    (await configuredCategoryService()).adminList(token),
  ]);
  return {
    actor,
    products,
    categories: categories.items.map((category) => ({ id: category.id, name: category.name })),
  };
}

export async function productEditorData(id?: string, requireManage = false) {
  const { actor, token } = await context();
  if (requireManage && !adminCapabilityMap[actor.role].includes("catalog.manage")) forbidden();
  const [categories, inventory, product] = await Promise.all([
    (await configuredCategoryService()).adminList(token),
    (await configuredInventoryService()).service.list(token),
    id ? (await configuredProductService()).detail(token, id) : Promise.resolve(null),
  ]);
  const items = inventory as {
    id: string;
    name: string;
    unit: "gram" | "milliliter" | "piece";
    status: string;
  }[];
  return {
    actor,
    product,
    categories: categories.items.map((category) => ({
      id: category.id,
      name: category.name,
      status: category.status,
    })),
    inventory: items.filter((item) => item.status === "active"),
  };
}
