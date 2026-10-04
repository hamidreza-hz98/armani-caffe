import type { MetadataRoute } from "next";

import { createSettingsService } from "@/modules/settings/server";
import { canonicalStorefrontUrl } from "@/storefront/seo-server";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  let indexable = false;
  try {
    indexable = (await (await createSettingsService()).publicSettings()).seo.indexable;
  } catch {
    // Keep HTML crawlable so its fail-closed noindex directive can be observed.
  }
  return {
    rules: { userAgent: "*", allow: "/" },
    ...(indexable ? { sitemap: new URL("/sitemap.xml", canonicalStorefrontUrl()).href } : {}),
  };
}
