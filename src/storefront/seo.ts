import type { Metadata } from "next";

import type { PublicSettings } from "@/modules/settings";

export const privatePageMetadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: null },
};

export function storefrontMetadata(settings: PublicSettings, appUrl: string): Metadata {
  const title = settings.seo.title || settings.business.title;
  const description =
    settings.seo.description ||
    settings.business.description ||
    "منوی آنلاین آرمانی کافه؛ نوشیدنی‌ها و خوراکی‌های تازه را ببینید.";
  const home = new URL("/", appUrl);
  return {
    metadataBase: home,
    title: { default: title, template: settings.seo.titleTemplate },
    description,
    alternates: { canonical: home.href, languages: { "fa-IR": home.href } },
    robots: { index: settings.seo.indexable, follow: settings.seo.indexable },
    openGraph: {
      type: "website",
      locale: "fa_IR",
      siteName: settings.business.title,
      title,
      description,
      url: home.href,
      images: [{ url: new URL("/social-preview", home).href, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [new URL("/social-preview", home).href],
    },
    icons: {
      icon: settings.business.faviconMediaId
        ? `/api/media/${settings.business.faviconMediaId}/file?variant=small`
        : [
            { url: "/favicon.ico", sizes: "any" },
            { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
            { url: "/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
          ],
      apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    },
    manifest: "/site.webmanifest",
  };
}
