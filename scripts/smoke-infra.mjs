import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const composeArgs = ["compose", "-f", "infra/compose.yaml"];

function docker(...args) {
  const result = spawnSync("docker", [...composeArgs, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

console.log("Checking MongoDB transaction...");
console.log(
  docker(
    "exec",
    "-T",
    "mongodb",
    "mongosh",
    "--quiet",
    "mongodb://127.0.0.1:27017/armani_caffe?directConnection=true",
    "/infra/mongo/smoke-transaction.js",
  ),
);

console.log("Checking Redis AOF configuration and restart persistence...");
const redisConfig = docker(
  "exec",
  "-T",
  "redis",
  "redis-cli",
  "CONFIG",
  "GET",
  "appendonly",
  "appendfsync",
);
assert.match(redisConfig, /appendonly\s+yes/i);
assert.match(redisConfig, /appendfsync\s+everysec/i);
const redisKey = "armani:infra:smoke";
const value = String(Date.now());
docker("exec", "-T", "redis", "redis-cli", "SET", redisKey, value);
await delay(1500);
docker("restart", "redis");

let redisReady = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    redisReady = docker("exec", "-T", "redis", "redis-cli", "PING") === "PONG";
  } catch {
    // The container may still be starting.
  }
  if (redisReady) break;
  await delay(1000);
}
assert.ok(redisReady, "Redis did not become ready after restart");
assert.equal(docker("exec", "-T", "redis", "redis-cli", "--raw", "GET", redisKey), value);
docker("exec", "-T", "redis", "redis-cli", "DEL", redisKey);
console.log("Redis value survived restart.");

console.log("Checking MinIO bucket initialization and anonymous access...");
console.log(docker("--profile", "init", "run", "--rm", "minio-init"));
const port = process.env.MINIO_API_PORT || "9000";
const bucket = process.env.MINIO_MEDIA_BUCKET || "armani-media";
const response = await fetch(`http://127.0.0.1:${port}/${bucket}/private-smoke-object`);
assert.equal(response.status, 403, "Private bucket should deny anonymous object reads");
const origin = "http://localhost:3000";
const preflight = await fetch(`http://127.0.0.1:${port}/${bucket}/private-smoke-object`, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": "content-type",
  },
});
assert.ok(preflight.ok, `MinIO CORS preflight failed with HTTP ${preflight.status}`);
assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
console.log("MinIO bucket exists, allowed-origin CORS works, and anonymous reads are denied.");
