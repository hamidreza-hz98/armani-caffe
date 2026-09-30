import "server-only";

export { PrintDispatcher } from "./print-dispatcher.ts";
export { createPrintRedis, type PrintSchedule } from "./print-redis.ts";

let closeActive: (() => Promise<void>) | null = null;
export function registerQueueCloser(close: () => Promise<void>): void {
  closeActive = close;
}
export async function closeQueueResources(): Promise<void> {
  const close = closeActive;
  closeActive = null;
  if (close) await close();
}
