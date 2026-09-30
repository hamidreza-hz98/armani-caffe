import type { ReactNode } from "react";

import { loadStorefrontShell } from "@/storefront/data";
import { StorefrontShell } from "@/storefront/storefront-shell";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const data = await loadStorefrontShell();
  return <StorefrontShell data={data}>{children}</StorefrontShell>;
}
