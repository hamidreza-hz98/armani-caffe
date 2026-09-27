import { spawnSync } from "node:child_process";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { test as baseTest } from "@playwright/test";

import { expect, test } from "../fixtures/playwright.ts";

test("Persian RTL home page is accessible and has no browser errors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "آرمانی کافه" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("design gallery renders RTL theme and local font accessibly", async ({ page, request }) => {
  const html = await (await request.get("/internal/design-system")).text();
  const [head, body] = html.split("</head>");
  expect(head).toContain('data-emotion="armani-rtl');
  expect(head).toContain("--armani-palette-primary-main");
  expect(body).not.toContain('data-emotion="armani-rtl');

  const thirdPartyFonts: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(request.url())) {
      thirdPartyFonts.push(request.url());
    }
  });
  await page.goto("/internal/design-system");
  await expect(page.getByRole("heading", { name: "آرمانی کافه" })).toBeVisible();
  await expect(page.getByText("۱۸۵٬۰۰۰ تومان")).toBeVisible();
  await expect(page.locator("bdi[dir='ltr']").first()).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => getComputedStyle(element).direction),
  ).toBe("rtl");
  expect(
    await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Vazirmatn");
  expect(
    await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(247, 242, 234)");
  expect(thirdPartyFonts).toEqual([]);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "افزودن" })).toBeFocused();
  const focusOutline = await page
    .getByRole("button", { name: "افزودن" })
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusOutline).not.toBe("none");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).toBe("auto");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

baseTest("production startup rejects a missing secret", () => {
  const result = spawnSync(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "start", "--port", "39999"],
    {
      cwd: process.cwd(),
      env: { ...process.env, AUTH_SESSION_SECRET: "" },
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("AUTH_SESSION_SECRET is required");
});
