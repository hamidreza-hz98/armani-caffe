import { Suspense } from "react";

import { cachedPublicMenu } from "@/server/catalog/menu-cache";
import { parseTableNumber } from "@/shared/table-number";
import { storefrontIsGuest } from "@/storefront/data";
import { menuCards } from "@/storefront/menu-model";
import { MenuFailure, MenuSkeleton, MenuView } from "@/storefront/menu-view";

async function MenuContent({
  tableNumber,
  invalidTable,
}: {
  tableNumber: number | null;
  invalidTable: boolean;
}) {
  let categories;
  const initialGuest = await storefrontIsGuest();
  try {
    categories = menuCards(await cachedPublicMenu());
  } catch {
    categories = null;
  }
  return categories ? (
    <MenuView
      categories={categories}
      initialGuest={initialGuest}
      tableNumber={tableNumber}
      invalidTable={invalidTable}
    />
  ) : (
    <MenuFailure />
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const query = (await searchParams).table;
  const tableNumber = parseTableNumber(query);
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <MenuContent
        tableNumber={tableNumber}
        invalidTable={query !== undefined && tableNumber === null}
      />
    </Suspense>
  );
}
