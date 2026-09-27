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
