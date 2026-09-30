import { type ReactNode, Suspense } from "react";

import { loadStorefrontShell } from "@/storefront/data";
import {
  StorefrontFrame,
  StorefrontHeader,
  StorefrontHeaderFallback,
} from "@/storefront/storefront-shell";

export const dynamic = "force-dynamic";

async function LiveHeader() {
  const data = await loadStorefrontShell();
  return <StorefrontHeader data={data} />;
}

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontFrame
      header={
        <Suspense fallback={<StorefrontHeaderFallback />}>
          <LiveHeader />
        </Suspense>
      }
    >
      {children}
    </StorefrontFrame>
  );
}
