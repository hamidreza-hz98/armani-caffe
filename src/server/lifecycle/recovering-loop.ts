import "server-only";

import { setTimeout as delay } from "node:timers/promises";

export function recoveryDelayMs(attempt: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError("Invalid retry attempt");
  const jitter = random();
  if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1)
    throw new RangeError("Random value must be in [0, 1)");
  return Math.round(Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 16)) * (0.75 + jitter / 2));
}

/** Retries infrastructure failures, but lets an in-flight operation finish before shutdown. */
export async function runRecoveringLoop(
  signal: AbortSignal,
  runOnce: () => Promise<boolean>,
  options: {
    idleMs: number;
    activeMs?: number;
    random?: () => number;
    onFailure: (error: unknown, attempt: number, retryMs: number) => void;
    onRecovery?: (failures: number) => void;
  },
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    let pauseMs: number;
    try {
      const active = await runOnce();
      if (failures) options.onRecovery?.(failures);
      failures = 0;
      pauseMs = active ? (options.activeMs ?? 0) : options.idleMs;
    } catch (error) {
      failures += 1;
      pauseMs = recoveryDelayMs(failures, options.random);
      options.onFailure(error, failures, pauseMs);
    }
    if (pauseMs > 0 && !signal.aborted) {
      try {
        await delay(pauseMs, undefined, { signal });
      } catch {
        break;
      }
    }
  }
}
