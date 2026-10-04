import { expect, test } from "vitest";

import { createPrintRedis } from "@/server/queue";

import { testEnv } from "../fixtures/config.mjs";

test("queue startup fails within a bounded time when Redis is unreachable", async () => {
  Object.assign(process.env, testEnv());
  await expect(createPrintRedis("redis://127.0.0.1:1", "recovery-test")).rejects.toThrow();
}, 10_000);
