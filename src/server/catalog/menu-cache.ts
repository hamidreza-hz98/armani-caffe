import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import type { MenuCategory } from "@/modules/catalog/products";

import { configuredProductService } from "./products";

export const MENU_CACHE_TAG = "storefront-menu-v1";

/** Cache the public projection only; cart/checkout always reprice from live catalog. */
export const cachedPublicMenu = unstable_cache(
  async (): Promise<MenuCategory[]> => (await configuredProductService()).menu(),
  [MENU_CACHE_TAG],
  { tags: [MENU_CACHE_TAG], revalidate: 30 },
);

export async function invalidateMenuAfter<T extends Response | Promise<Response>>(
  response: T,
): Promise<Response> {
  const result = await response;
  if (result.ok) revalidateTag(MENU_CACHE_TAG, { expire: 0 });
  return result;
}
