import { expect, test } from "vitest";

import { registerResource, shutdownResources } from "@/server/lifecycle";

import { testEnv } from "../fixtures/config.mjs";

test("shutdown closes registered resources once and rejects new ones", async () => {
  Object.assign(process.env, testEnv());
  const closed: string[] = [];
  registerResource("test-queue", async () => {
    closed.push("queue");
  });
  registerResource("test-realtime", async () => {
    closed.push("realtime");
  });
  expect(await shutdownResources()).toBe(true);
  expect(closed).toEqual(["realtime", "queue"]);
  expect(await shutdownResources()).toBe(true);
  expect(() => registerResource("late", async () => undefined)).toThrow();
});
