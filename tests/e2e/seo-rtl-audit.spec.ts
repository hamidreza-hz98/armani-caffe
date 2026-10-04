import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "../fixtures/playwright.ts";

test("public metadata and crawl files remain safe before SEO is enabled", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\//u);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "fa_IR");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/social-preview/u,
  );
  const preview = await request.get("/social-preview");
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toContain("image/png");
  expect((await preview.body()).byteLength).toBeGreaterThan(1_000);
  const fallbackIcon = await request.get("/armani-icon.svg");
  expect(fallbackIcon.status()).toBe(200);
  expect(fallbackIcon.headers()["content-type"]).toContain("image/svg+xml");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Allow: /");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain("<loc>");
});

test("customer-specific, admin and preview pages are noindex", async ({ request }) => {
  for (const path of [
    "/cart",
    "/account",
    "/payment/result",
    "/orders/000000000000000000000001",
    "/dashboard/login",
    "/admin/login",
    "/internal/payment-preview",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBeLessThan(400);
    const html = await response.text();
    expect(html, path).toMatch(/<meta name="robots" content="[^"]*noindex/u);
    if (
      path.startsWith("/cart") ||
      path.startsWith("/account") ||
      path.startsWith("/orders") ||
      path.startsWith("/payment")
    )
      expect(html, path).not.toContain('rel="canonical"');
  }
});

test("mobile menu keeps semantic landmarks and has no serious axe findings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});
