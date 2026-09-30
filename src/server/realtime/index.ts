import "server-only";

export { startPrintRealtime } from "./print-server.ts";
let closeActive: (() => Promise<void>) | null = null;
export function registerRealtimeCloser(close: () => Promise<void>): void {
  closeActive = close;
}
export async function closeRealtimeResources(): Promise<void> {
  const close = closeActive;
  closeActive = null;
  if (close) await close();
}
