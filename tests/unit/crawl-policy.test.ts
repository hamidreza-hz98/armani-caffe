import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ indexable: false, fail: false }));

vi.mock("@/modules/settings/server", () => ({
  createSettingsService: async () => ({
    publicSettings: async () => {
      if (state.fail) throw new Error("settings unavailable");
      return { seo: { indexable: state.indexable } };
    },
  }),
}));
vi.mock("@/storefront/seo-server", () => ({
  canonicalStorefrontUrl: () => new URL("https://caffe.example/"),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

test("sitemap advertises only the canonical menu after an explicit SEO opt-in", async () => {
  state.indexable = false;
  expect(await sitemap()).toEqual([]);
  expect(await robots()).not.toHaveProperty("sitemap");
  state.indexable = true;
  expect(await sitemap()).toEqual([
    { url: "https://caffe.example/", changeFrequency: "weekly", priority: 1 },
  ]);
  expect(await robots()).toMatchObject({ sitemap: "https://caffe.example/sitemap.xml" });
});

test("dependency failure does not accidentally publish sitemap URLs", async () => {
  state.fail = true;
  try {
    expect(await sitemap()).toEqual([]);
    expect(await robots()).toMatchObject({ rules: { allow: "/" } });
  } finally {
    state.fail = false;
    state.indexable = false;
  }
});
