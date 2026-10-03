import type { Metadata } from "next";

import { InventoryManager } from "@/dashboard/inventory/manager";
import { inventoryPageData } from "@/dashboard/inventory/server";

export const metadata: Metadata = {
  title: "موجودی و تأییدها",
  robots: { index: false, follow: false },
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor, snapshot } = await inventoryPageData();
  const raw = await searchParams;
  return (
    <InventoryManager
      initial={snapshot}
      isOwner={actor.role === "OWNER"}
      query={typeof raw.q === "string" ? raw.q.slice(0, 80) : ""}
      status={
        raw.status === "low" || raw.status === "out" || raw.status === "archived"
          ? raw.status
          : "all"
      }
    />
  );
}
