import { expect, test } from "vitest";

import { type PublicSettings, settingsDefaults } from "@/modules/settings";
import { privatePageMetadata, storefrontMetadata } from "@/storefront/seo";

const settings: PublicSettings = {
  business: settingsDefaults("business"),
  contact: { ...settingsDefaults("contact"), mapUrl: null },
  seo: { ...settingsDefaults("seo"), indexable: true },
};

test("public metadata uses the configured canonical origin and Persian SEO fields", () => {
  const metadata = storefrontMetadata(
    {
      ...settings,
      seo: { ...settings.seo, title: "منوی کافه", description: "قهوه تازه" },
    },
    "https://caffe.example/unused/path",
  );
  expect(metadata.metadataBase?.toString()).toBe("https://caffe.example/");
  expect(metadata.alternates?.canonical).toBe("https://caffe.example/");
  expect(metadata.robots).toMatchObject({ index: true, follow: true });
  expect(metadata.openGraph).toMatchObject({
    title: "منوی کافه",
    description: "قهوه تازه",
    locale: "fa_IR",
    url: "https://caffe.example/",
  });
  expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  expect(metadata.icons).toEqual({ icon: "/armani-icon.svg" });
});

test("indexing stays off by default and customer-specific pages explicitly opt out", () => {
  const metadata = storefrontMetadata(settingsDefaultsView(), "https://caffe.example");
  expect(metadata.robots).toMatchObject({ index: false, follow: false });
  expect(privatePageMetadata.robots).toMatchObject({
    index: false,
    follow: false,
    nocache: true,
  });
  expect(privatePageMetadata.alternates?.canonical).toBeNull();
});

function settingsDefaultsView(): PublicSettings {
  return { ...settings, seo: settingsDefaults("seo") };
}
