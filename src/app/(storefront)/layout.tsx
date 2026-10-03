import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";

import { createSettingsService } from "@/modules/settings/server";
import { loadStorefrontShell } from "@/storefront/data";
import {
  StorefrontFrame,
  StorefrontHeader,
  StorefrontHeaderFallback,
} from "@/storefront/storefront-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { business, seo } = await (await createSettingsService()).publicSettings();
    return {
      title: { default: seo.title, template: seo.titleTemplate },
      description: seo.description || business.description || undefined,
      robots: { index: seo.indexable, follow: seo.indexable },
      icons: {
        icon: business.faviconMediaId
          ? `/api/media/${business.faviconMediaId}/file?variant=small`
          : "/armani-icon.svg",
      },
    };
  } catch {
    return { title: "آرمانی کافه", icons: { icon: "/armani-icon.svg" } };
  }
}

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
