import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import {
  architectureViolations,
  moduleNames,
  readSourceTree,
} from "../../scripts/check-architecture.mjs";

test("all planned modules obey architecture boundaries", async () => {
  const files = await readSourceTree(path.resolve("src"));
  assert.equal(moduleNames.length, 16);
  assert.deepEqual(architectureViolations(files), []);
});

test("routes cannot import module persistence or server database details", () => {
  const files = new Map([
    [
      "src/app/api/example/route.ts",
      'import "@/modules/orders/infrastructure/index.ts"; import "@/server/database/index.ts";',
    ],
    ["src/modules/orders/infrastructure/index.ts", 'import "server-only"; export {};'],
    ["src/server/database/index.ts", 'import "server-only"; export {};'],
  ]);
  const issues = architectureViolations(files, { requireLayout: false });
  assert.ok(
    issues.some((issue) => issue.includes("UI/routes must use the public module boundary")),
  );
  assert.ok(
    issues.some((issue) => issue.includes("UI/routes must not import persistence internals")),
  );
});

test("cross-module persistence imports and application-to-adapter imports are rejected", () => {
  const files = new Map([
    [
      "src/modules/orders/application/index.ts",
      'import "../infrastructure/index.ts"; import "@/modules/payments/infrastructure/index.ts";',
    ],
    ["src/modules/orders/infrastructure/index.ts", 'import "server-only"; export {};'],
    ["src/modules/payments/infrastructure/index.ts", 'import "server-only"; export {};'],
  ]);
  const issues = architectureViolations(files, { requireLayout: false });
  assert.ok(issues.some((issue) => issue.includes("application must not import infrastructure")));
  assert.ok(issues.some((issue) => issue.includes("cross-module imports must use")));
});

test("domain/application cannot import React or routes, and cycles are rejected", () => {
  const files = new Map([
    ["src/modules/orders/domain/a.ts", 'import React from "react"; import "./b.ts";'],
    ["src/modules/orders/domain/b.ts", 'import "./a.ts"; import "@/app/page.tsx";'],
    ["src/app/page.tsx", "export {};"],
    ["src/modules/orders/application/service.ts", 'import "next/navigation";'],
  ]);
  const issues = architectureViolations(files, { requireLayout: false });
  assert.ok(issues.some((issue) => issue.includes("domain must not import react")));
  assert.ok(issues.some((issue) => issue.includes("application must not import next/navigation")));
  assert.ok(issues.some((issue) => issue.includes("modules must not import route or UI code")));
  assert.ok(issues.some((issue) => issue.includes("Circular dependency")));
});

test("files outside declared module layers are rejected", () => {
  const files = new Map([["src/modules/orders/repository.ts", "export {};"]]);
  assert.ok(
    architectureViolations(files, { requireLayout: false }).some((issue) =>
      issue.includes("file must live in a declared module layer"),
    ),
  );
});
