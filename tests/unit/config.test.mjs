import assert from "node:assert/strict";

import { test } from "vitest";

import { parsePublicConfig } from "../../src/config/public-schema.ts";
import { parseServerConfig } from "../../src/config/server-schema.ts";
import { testEnv } from "../fixtures/config.mjs";

test("server configuration parses a complete environment", () => {
  const config = parseServerConfig(testEnv(), "production");
  assert.equal(config.minio.bucket, "armani-test-media");
  assert.equal(config.webSocket.port, 3001);
  assert.equal(config.logLevel, "info");
  assert.equal(config.logFormat, "json");
  assert.equal(config.test, null);
});

test("public configuration exposes only allowlisted browser values", () => {
  const config = parsePublicConfig(testEnv());
  assert.deepEqual(Object.keys(config).sort(), ["appUrl", "webSocketUrl"]);
  assert.equal(config.appUrl, "http://localhost:3000");
  assert.equal(config.webSocketUrl, "ws://localhost:3001/ws");
});

test("missing and invalid values produce useful errors without leaking values", () => {
  const badSecret = "short-private-value";
  assert.throws(
    () =>
      parseServerConfig(
        testEnv({
          MONGODB_URI: "not-a-url",
          AUTH_SESSION_SECRET: badSecret,
          ENCRYPTION_KEY: "",
        }),
        "production",
      ),
    (error) => {
      assert.match(error.message, /MONGODB_URI/);
      assert.match(error.message, /AUTH_SESSION_SECRET/);
      assert.match(error.message, /ENCRYPTION_KEY/);
      assert.doesNotMatch(error.message, /short-private-value/);
      return true;
    },
  );
});

test("test defaults and explicit overrides are deterministic", () => {
  const first = parseServerConfig(testEnv(), "test");
  const second = parseServerConfig(testEnv(), "test");
  assert.deepEqual(first.test, second.test);
  assert.deepEqual(first.test, { fixedTime: "2025-01-01T00:00:00.000Z", randomSeed: 42 });

  const overridden = parseServerConfig(
    testEnv({
      TEST_FIXED_TIME: "2026-01-02T03:04:05.000Z",
      TEST_RANDOM_SEED: "123",
      MONGODB_URI: "mongodb://127.0.0.1:27018/isolated_test",
    }),
    "test",
  );
  assert.deepEqual(overridden.test, {
    fixedTime: "2026-01-02T03:04:05.000Z",
    randomSeed: 123,
  });
  assert.match(overridden.mongodbUri, /isolated_test/);
  assert.throws(
    () => parseServerConfig(testEnv({ TEST_RANDOM_SEED: "123" }), "production"),
    /TEST_FIXED_TIME and TEST_RANDOM_SEED are allowed only in test mode/,
  );
});
