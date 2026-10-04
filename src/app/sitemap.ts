import type { MetadataRoute } from "next";

import { createSettingsService } from "@/modules/settings/server";
import { canonicalStorefrontUrl } from "@/storefront/seo-server";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const { seo } = await (await createSettingsService()).publicSettings();
    return seo.indexable
      ? [
          {
            url: canonicalStorefrontUrl().href,
            changeFrequency: "weekly",
            priority: 1,
          },
        ]
      : [];
  } catch {
    return [];
  }
}
