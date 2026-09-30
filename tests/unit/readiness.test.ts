import { expect, test } from "vitest";

import { checkReadiness } from "@/server/health/readiness";

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
