import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { test } from "vitest";

function dbCommand(args, env = process.env) {
  return spawnSync(process.execPath, ["--conditions=react-server", "scripts/db.mjs", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 15000,
  });
}

test("index plan is read-only and available without a database connection", () => {
  const result = dbCommand(["indexes:plan"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /migration_applied_at/);
  assert.match(result.stdout, /seed_created_at/);
});

test("mutating database commands require explicit opt-in", () => {
  const result = dbCommand(["migrate:up"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pass --apply explicitly/);
});

test("seed refuses non-local database hosts before connecting", () => {
  const result = dbCommand(["seed", "--apply"], {
    ...process.env,
    NODE_ENV: "development",
    MONGODB_URI: "mongodb://db.example.invalid:27018/armani_caffe",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a loopback MongoDB host/);
});
