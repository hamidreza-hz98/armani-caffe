import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { boundaryViolations } from "../../scripts/check-server-boundaries.mjs";

const root = process.cwd();

test("application server modules are protected", async () => {
  assert.deepEqual(await boundaryViolations(path.join(root, "src/server")), []);
});

test("package manager and environment conventions are committed", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
  const example = await readFile(path.join(root, ".env.example"), "utf8");

  assert.equal(manifest.packageManager, "npm@11.12.1");
  assert.equal(lock.name, manifest.name);
  assert.match(ignore, /^\.env\*/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(example, /NEXT_PUBLIC_/);
});
