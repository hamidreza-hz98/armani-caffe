import "server-only";

import { closeDatabaseConnection } from "../database/connection.ts";
import { logEvent } from "../observability/index.ts";
import { closeQueueResources } from "../queue/index.ts";
import { closeRealtimeResources } from "../realtime/index.ts";

type Close = () => Promise<void>;
type State = { closers: Map<string, Close>; shutdown: Promise<boolean> | null; installed: boolean };
const store = globalThis as typeof globalThis & { __armaniLifecycle?: State };
const state = (store.__armaniLifecycle ??= {
  closers: new Map(),
  shutdown: null,
  installed: false,
});

export function registerResource(name: string, close: Close): () => void {
  if (state.shutdown) throw new Error("Cannot register resources during shutdown");
  if (state.closers.has(name)) throw new Error(`Resource already registered: ${name}`);
  state.closers.set(name, close);
  return () => state.closers.delete(name);
}

async function closeWithin(name: string, close: Close): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Shutdown timed out")), 5000);
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
    const results = await Promise.all(resources.map(([name, close]) => closeWithin(name, close)));
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
