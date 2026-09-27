import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import { boundaryViolations } from "../../scripts/check-server-boundaries.mjs";
import { parseServerConfig } from "../../src/config/server-schema.ts";
import { testEnv } from "../fixtures/config.mjs";

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

test("documented example covers the validated runtime configuration", async () => {
  const example = await readFile(path.join(root, ".env.example"), "utf8");
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const variables = Object.fromEntries(
    example
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const equals = line.indexOf("=");
        return [line.slice(0, equals), line.slice(equals + 1)];
      }),
  );
  const fixture = testEnv();
  for (const name of [
    "AUTH_SESSION_SECRET",
    "AUTH_ADMIN_SESSION_SECRET",
    "ENCRYPTION_KEY",
    "PRINTER_BRIDGE_TOKEN",
  ]) {
    variables[name] = fixture[name];
  }

  assert.equal(parseServerConfig(variables, "development").minio.bucket, "armani-media");
  assert.deepEqual(
    Object.keys(variables).filter((name) => name.startsWith("NEXT_PUBLIC_")),
    ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_WS_URL"],
  );
  for (const name of Object.keys(variables)) {
    assert.ok(readme.includes(`\`${name}\``), `${name} is missing from README.md`);
  }
  assert.ok(readme.includes("`TEST_FIXED_TIME`"));
  assert.ok(readme.includes("`TEST_RANDOM_SEED`"));
});
