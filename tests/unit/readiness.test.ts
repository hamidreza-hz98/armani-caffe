import { expect, test } from "vitest";

import { checkReadiness } from "@/server/health/readiness";

import { testEnv } from "../fixtures/config.mjs";

test("readiness reports all independent dependencies when they respond", async () => {
  const result = await checkReadiness({
    mongodb: async () => undefined,
    redis: async () => undefined,
    minio: async () => undefined,
    queue: async () => undefined,
    realtime: async () => undefined,
  });
  expect(result).toEqual({
    status: "ready",
    checks: { mongodb: "up", redis: "up", minio: "up", queue: "up", realtime: "up" },
  });
});

test("partial outage stays not-ready and recovery is visible on the next probe", async () => {
  Object.assign(process.env, testEnv());
  let storageUp = false;
  const probes = {
    mongodb: async () => undefined,
    redis: async () => undefined,
    minio: async () => {
      if (!storageUp) throw new Error("storage offline");
    },
    queue: async () => undefined,
    realtime: async () => undefined,
  };
  expect(await checkReadiness(probes)).toMatchObject({
    status: "not_ready",
    checks: { mongodb: "up", redis: "up", minio: "down", queue: "up", realtime: "up" },
  });
  storageUp = true;
  expect(await checkReadiness(probes)).toMatchObject({
    status: "ready",
    checks: { minio: "up" },
  });
});
