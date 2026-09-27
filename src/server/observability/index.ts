import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { getServerConfig } from "../secrets/config.ts";
import { redact } from "./redact.ts";

type Context = Readonly<{ requestId: string; startedAt: number }>;
type Level = "debug" | "info" | "warn" | "error";
const context = new AsyncLocalStorage<Context>();
const levels: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function requestIdFromHeader(value: string | null): string {
  return value && /^[a-f0-9-]{36}$/i.test(value) ? value : randomUUID();
}

export function currentRequestId(): string {
  return context.getStore()?.requestId ?? randomUUID();
}

export function withRequestContext<T>(requestId: string, run: () => Promise<T>): Promise<T> {
  return context.run({ requestId, startedAt: performance.now() }, run);
}

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const config = getServerConfig();
  if (levels[level] < levels[config.logLevel]) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    event,
    requestId: context.getStore()?.requestId ?? null,
    ...fields,
  };
  const secrets = [
    config.mongodbUri,
    config.redisUrl,
    config.minio.accessKey,
    config.minio.secretKey,
    config.auth.sessionSecret,
    config.auth.adminSessionSecret,
    config.encryption.key,
    config.encryption.previousKey ?? "",
    config.printerBridge.token,
  ];
  const safe = redact(entry, 0, secrets);
  const line =
    config.logFormat === "json"
      ? JSON.stringify(safe)
      : `[${level}] ${event} ${JSON.stringify(safe)}`;
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

export async function timedRequest<T>(
  request: Request,
  operation: string,
  run: () => Promise<T>,
): Promise<{ value: T; requestId: string }> {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  return withRequestContext(requestId, async () => {
    const start = performance.now();
    try {
      const value = await run();
      logEvent("info", "request.complete", {
        operation,
        durationMs: Math.round(performance.now() - start),
      });
      return { value, requestId };
    } catch (error) {
      logEvent("error", "request.failed", {
        operation,
        durationMs: Math.round(performance.now() - start),
        error,
      });
      throw error;
    }
  });
}
