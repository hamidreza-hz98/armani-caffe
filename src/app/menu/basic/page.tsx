import type { Metadata } from "next";

import { cachedPublicMenu } from "@/server/catalog/menu-cache";
import { menuCards } from "@/storefront/menu-model";
import { MenuFailure, MenuView } from "@/storefront/menu-view";
import { StorefrontShell } from "@/storefront/storefront-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BasicMenu() {
  let categories;
  try {
    categories = menuCards(await cachedPublicMenu());
  } catch {
    categories = null;
  }
  return (
    <StorefrontShell
      data={{
        businessName: "کافه آرمانی",
        account: { state: "guest", name: null },
        cartCount: 0,
        contacts: [],
        contactAddress: "",
        settingsAvailable: true,
      }}
    >
      {categories ? <MenuView categories={categories} /> : <MenuFailure />}
    </StorefrontShell>
  );
}
