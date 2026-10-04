import "server-only";

import { createClient } from "redis";

import { logEvent } from "../observability/index.ts";

export type PrintSchedule = {
  schedule(jobId: string, at: Date): Promise<void>;
  due(now: Date, limit: number): Promise<string[]>;
  remove(jobId: string): Promise<void>;
  acquirePresence(printerId: string, instanceId: string, ttlMs: number): Promise<boolean>;
  refreshPresence(printerId: string, instanceId: string, ttlMs: number): Promise<boolean>;
  releasePresence(printerId: string, instanceId: string): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
};

const refreshScript =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const releaseScript =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";

export async function createPrintRedis(
  url: string,
  prefix: string,
  startupTimeoutMs = 5000,
): Promise<PrintSchedule> {
  if (!/^[a-zA-Z0-9:_-]{3,100}$/u.test(prefix)) throw new Error("Invalid queue prefix");
  if (
    !Number.isSafeInteger(startupTimeoutMs) ||
    startupTimeoutMs < 100 ||
    startupTimeoutMs > 10_000
  )
    throw new RangeError("Invalid Redis startup timeout");
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2500,
      reconnectStrategy: (retries) =>
        Math.min(5000, 100 * 2 ** Math.min(retries, 6)) + Math.floor(Math.random() * 250),
    },
  });
  client.on("error", (error) => logEvent("warn", "print.redis_error", { error }));
  const startupTimeout = setTimeout(() => client.destroy(), startupTimeoutMs);
  try {
    await client.connect();
  } catch (error) {
    client.destroy();
    throw error;
  } finally {
    clearTimeout(startupTimeout);
  }
  const dueKey = `${prefix}:print:due`;
  const presenceKey = (id: string) => `${prefix}:printer:presence:${id}`;
  return {
    async schedule(id, at) {
      await client.zAdd(dueKey, { value: id, score: at.getTime() });
    },
    due(now, limit) {
      return client.zRangeByScore(dueKey, 0, now.getTime(), {
        LIMIT: { offset: 0, count: Math.min(limit, 100) },
      });
    },
    async remove(id) {
      await client.zRem(dueKey, id);
    },
    async acquirePresence(id, instance, ttl) {
      return (await client.set(presenceKey(id), instance, { NX: true, PX: ttl })) === "OK";
    },
    async refreshPresence(id, instance, ttl) {
      return (
        (await client.eval(refreshScript, {
          keys: [presenceKey(id)],
          arguments: [instance, String(ttl)],
        })) === 1
      );
    },
    async releasePresence(id, instance) {
      await client.eval(releaseScript, { keys: [presenceKey(id)], arguments: [instance] });
    },
    async ping() {
      if ((await client.ping()) !== "PONG") throw new Error("Redis queue unavailable");
    },
    async close() {
      if (client.isReady) await client.close();
      else client.destroy();
    },
  };
}
