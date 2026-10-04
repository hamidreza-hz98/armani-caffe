import { expect, test } from "vitest";

import { registerResource, shutdownResources } from "@/server/lifecycle";

import { testEnv } from "../fixtures/config.mjs";

test("shutdown closes registered resources once and rejects new ones", async () => {
  Object.assign(process.env, testEnv());
  const closed: string[] = [];
  expect(() => registerResource("bad-timeout", async () => undefined, 30_001)).toThrow();
  registerResource("test-queue", async () => {
    expect(closed).toEqual(["worker", "realtime"]);
    closed.push("queue");
  });
  registerResource("test-realtime", async () => {
    await Promise.resolve();
    closed.push("realtime");
  });
  registerResource(
    "test-worker",
    async () => {
      await Promise.resolve();
      closed.push("worker");
    },
    30_000,
  );
  expect(await shutdownResources()).toBe(true);
  expect(closed).toEqual(["worker", "realtime", "queue"]);
  expect(await shutdownResources()).toBe(true);
  expect(() => registerResource("late", async () => undefined)).toThrow();
});
