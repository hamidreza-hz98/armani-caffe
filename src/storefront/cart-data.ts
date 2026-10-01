import "server-only";

import { cookies } from "next/headers";

import { customerCookieName, validCustomerToken } from "@/modules/auth";
import { configuredCustomerSecurity } from "@/modules/auth/server";
import { cachedPublicMenu } from "@/server/catalog/menu-cache";
import { getServerConfig } from "@/server/secrets/config";

export async function loadCartPageData() {
  const config = getServerConfig();
  const token = (await cookies()).get(customerCookieName(config.mode === "production"))?.value;
  if (!validCustomerToken(token)) return { productImages: {}, customer: null };
  const [menu, customer] = await Promise.allSettled([
    cachedPublicMenu(),
    configuredCustomerSecurity().then(({ auth }) => auth.profile(token)),
  ]);
  const productImages: Record<string, string> = {};
  if (menu.status === "fulfilled")
    for (const category of menu.value)
      for (const product of category.products)
        if (product.mediaIds[0]) productImages[product.id] = product.mediaIds[0];
  const profile = customer.status === "fulfilled" ? customer.value : null;
  return {
    productImages,
    customer: profile ? { displayName: profile.displayName, phone: profile.phone } : null,
  };
}
