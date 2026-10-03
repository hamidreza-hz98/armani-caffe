import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? "3107");
const baseURL = `http://127.0.0.1:${port}`;
const localChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const channel =
  process.env.E2E_BROWSER_CHANNEL ||
  (process.platform === "win32" && existsSync(localChrome) ? "chrome" : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
    {
      name: "webkit-storefront",
      testMatch: "**/storefront-journeys.spec.ts",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
