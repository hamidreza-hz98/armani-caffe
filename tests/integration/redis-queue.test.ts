import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, beforeAll, expect, test } from "vitest";

import { createPrintRedis, type PrintSchedule } from "@/server/queue";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

const redisUrl = process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6379";
const prefix = isolatedResources("redisqueue").redisPrefix.replace(/:$/u, "");
let schedule: PrintSchedule;

beforeAll(async () => {
  Object.assign(process.env, testEnv());
  try {
    schedule = await createPrintRedis(redisUrl, prefix);
    await schedule.ping();
  } catch (error) {
    throw new Error(
      "Real Redis is required. Start the local Redis service or set REDIS_TEST_URL for a dedicated test server. Tests use an isolated random key prefix.",
      { cause: error },
    );
  }
});

afterAll(async () => {
  if (!schedule) return;
  for (const id of ["future", "due-a", "due-b"]) await schedule.remove(id);
  await schedule.releasePresence("printer-a", "instance-a");
  await schedule.releasePresence("printer-expiring", "instance-expiring");
  await schedule.close();
});

test("sorted queue survives adapter restart and returns only bounded due jobs", async () => {
  const now = new Date("2026-10-03T12:00:00.000Z");
  await schedule.schedule("future", new Date(now.getTime() + 60_000));
  await schedule.schedule("due-b", new Date(now.getTime() - 1));
  await schedule.schedule("due-a", new Date(now.getTime() - 2));
  expect(await schedule.due(now, 1)).toEqual(["due-a"]);
  await schedule.close();
  schedule = await createPrintRedis(redisUrl, prefix);
  expect(await schedule.due(now, 1000)).toEqual(["due-a", "due-b"]);
  await schedule.remove("due-a");
  await schedule.remove("due-b");
  expect(await schedule.due(now, 100)).toEqual([]);
});

test("presence lease is owner-safe, mutually exclusive, and expires", async () => {
  expect(await schedule.acquirePresence("printer-a", "instance-a", 5_000)).toBe(true);
  expect(await schedule.acquirePresence("printer-a", "instance-b", 5_000)).toBe(false);
  expect(await schedule.refreshPresence("printer-a", "instance-b", 5_000)).toBe(false);
  expect(await schedule.refreshPresence("printer-a", "instance-a", 5_000)).toBe(true);
  await schedule.releasePresence("printer-a", "instance-b");
  expect(await schedule.acquirePresence("printer-a", "instance-b", 5_000)).toBe(false);
  await schedule.releasePresence("printer-a", "instance-a");
  expect(await schedule.acquirePresence("printer-a", "instance-b", 5_000)).toBe(true);
  await schedule.releasePresence("printer-a", "instance-b");

  const expiringInstance = `instance-${randomUUID()}`;
  expect(await schedule.acquirePresence("printer-expiring", expiringInstance, 100)).toBe(true);
  await delay(150);
  expect(await schedule.acquirePresence("printer-expiring", "instance-after-expiry", 5_000)).toBe(
    true,
  );
  await schedule.releasePresence("printer-expiring", "instance-after-expiry");
});

test("invalid queue namespaces are rejected before connecting", async () => {
  await expect(createPrintRedis(redisUrl, "../shared")).rejects.toThrow("Invalid queue prefix");
});
