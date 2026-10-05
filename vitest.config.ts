import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": sourceRoot,
      "server-only": fileURLToPath(new URL("./tests/fixtures/server-only.ts", import.meta.url)),
    },
  },
  test: {
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}", "bridge/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.{mjs,ts,tsx}"],
          exclude: ["tests/unit/**/*.client.test.tsx"],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.{mjs,ts,tsx}"],
          testTimeout: 180_000,
          hookTimeout: 180_000,
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: ["tests/client/**/*.test.tsx"],
          setupFiles: ["./tests/fixtures/client-setup.ts"],
          testTimeout: 10_000,
        },
      },
    ],
  },
});
