import "server-only";

import { closeDatabaseConnection } from "../database/connection.ts";
import { logEvent } from "../observability/index.ts";
import { closeQueueResources } from "../queue/index.ts";
import { closeRealtimeResources } from "../realtime/index.ts";

type Close = () => Promise<void>;
type Resource = { close: Close; timeoutMs: number };
type State = {
  closers: Map<string, Resource>;
  shutdown: Promise<boolean> | null;
  installed: boolean;
};
const store = globalThis as typeof globalThis & { __armaniLifecycle?: State };
const state = (store.__armaniLifecycle ??= {
  closers: new Map(),
  shutdown: null,
  installed: false,
});

export function registerResource(name: string, close: Close, timeoutMs = 5000): () => void {
  if (state.shutdown) throw new Error("Cannot register resources during shutdown");
  if (state.closers.has(name)) throw new Error(`Resource already registered: ${name}`);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new RangeError("Invalid resource shutdown timeout");
  state.closers.set(name, { close, timeoutMs });
  return () => state.closers.delete(name);
}

async function closeWithin(name: string, resource: Resource): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      resource.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Shutdown timed out")), resource.timeoutMs);
      }),
    ]);
    logEvent("info", "resource.closed", { resource: name });
    return true;
  } catch (error) {
    logEvent("error", "resource.close_failed", { resource: name, error });
    return false;
  } finally {
    clearTimeout(timer!);
  }
}

export function shutdownResources(): Promise<boolean> {
  if (state.shutdown) return state.shutdown;
  state.shutdown = (async () => {
    const resources = [...state.closers.entries()].reverse();
    const results: boolean[] = [];
    for (const [name, resource] of resources) results.push(await closeWithin(name, resource));
    state.closers.clear();
    return results.every(Boolean);
  })();
  return state.shutdown;
}

export function installShutdownHandlers(): void {
  if (state.installed) return;
  state.installed = true;
  registerResource("mongodb", closeDatabaseConnection);
  registerResource("queue", closeQueueResources);
  registerResource("realtime", closeRealtimeResources);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logEvent("info", "process.shutdown", { signal });
      void shutdownResources().then((clean) => process.exit(clean ? 0 : 1));
    });
  }
}
