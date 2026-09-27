import { spawnSync } from "node:child_process";
import path from "node:path";

import { testEnv } from "../tests/fixtures/config.mjs";

const env = { ...process.env, ...testEnv() };
env.NODE_ENV = "production";
delete env.ENCRYPTION_KEY_PREVIOUS;
delete env.TEST_FIXED_TIME;
delete env.TEST_RANDOM_SEED;

function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run([path.join("node_modules", "next", "dist", "bin", "next"), "build"]);
run(["--test", "tests/e2e/*.test.mjs"]);
