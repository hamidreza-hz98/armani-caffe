import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";

import { createSettingsService } from "@/modules/settings/server";
import { loadStorefrontShell } from "@/storefront/data";
import { storefrontMetadata } from "@/storefront/seo";
import { canonicalStorefrontUrl } from "@/storefront/seo-server";
import {
  StorefrontFrame,
  StorefrontHeader,
  StorefrontHeaderFallback,
} from "@/storefront/storefront-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await (await createSettingsService()).publicSettings();
    return storefrontMetadata(settings, canonicalStorefrontUrl().href);
  } catch {
    const home = canonicalStorefrontUrl();
    return {
      metadataBase: home,
      title: "آرمانی کافه",
      description: "منوی آنلاین آرمانی کافه",
      alternates: { canonical: home.href },
      robots: { index: false, follow: false, nocache: true },
      openGraph: {
        type: "website",
        locale: "fa_IR",
        title: "آرمانی کافه",
        description: "منوی آنلاین آرمانی کافه",
        url: home.href,
        images: [{ url: new URL("/social-preview", home).href, width: 1200, height: 630 }],
      },
      icons: { icon: "/armani-icon.svg" },
    };
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
