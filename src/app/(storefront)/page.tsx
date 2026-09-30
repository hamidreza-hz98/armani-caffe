import { Suspense } from "react";

import { cachedPublicMenu } from "@/server/catalog/menu-cache";
import { menuCards } from "@/storefront/menu-model";
import { MenuFailure, MenuSkeleton, MenuView } from "@/storefront/menu-view";

async function MenuContent() {
  let categories;
  try {
    categories = menuCards(await cachedPublicMenu());
  } catch {
    categories = null;
  }
  return categories ? <MenuView categories={categories} /> : <MenuFailure />;
}

export default function Home() {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <MenuContent />
    </Suspense>
  );
}
