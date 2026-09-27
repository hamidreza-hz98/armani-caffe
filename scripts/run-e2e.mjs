import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { testEnv } from "../tests/fixtures/config.mjs";
import { isolatedResources } from "../tests/fixtures/isolation.ts";

const resources = isolatedResources("e2e");
const env = {
  ...process.env,
  ...testEnv({
    MONGODB_URI: `mongodb://127.0.0.1:1/${resources.databaseName}?directConnection=true`,
    MINIO_BUCKET: resources.minioBucket,
  }),
  TEST_REDIS_PREFIX: resources.redisPrefix,
};
env.NODE_ENV = "production";
delete env.ENCRYPTION_KEY_PREVIOUS;
delete env.TEST_FIXED_TIME;
delete env.TEST_RANDOM_SEED;
delete env.NO_COLOR;

const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
env.E2E_PORT = String(listener.address().port);
await new Promise((resolve) => listener.close(resolve));

function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run([path.join("node_modules", "next", "dist", "bin", "next"), "build"]);
run([path.join("node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)]);
