import { describe, expect, it } from "vitest";

import { recoveryDelayMs, runRecoveringLoop } from "@/server/lifecycle/recovering-loop";

describe("worker outage recovery", () => {
  it("caps exponential retry with bounded jitter", () => {
    expect(recoveryDelayMs(1, () => 0)).toBe(375);
    expect(recoveryDelayMs(2, () => 0.5)).toBe(1000);
    expect(recoveryDelayMs(100, () => 0)).toBe(22_500);
    expect(() => recoveryDelayMs(0)).toThrow();
    expect(() => recoveryDelayMs(1, () => 1)).toThrow();
  });

  it("continues after a transient failure and reports recovery", async () => {
    const controller = new AbortController();
    const failed: number[] = [];
    const recovered: number[] = [];
    let runs = 0;
    await runRecoveringLoop(
      controller.signal,
      async () => {
        runs += 1;
        if (runs === 1) throw new Error("temporary dependency outage");
        controller.abort();
        return true;
      },
      {
        idleMs: 10,
        random: () => 0,
        onFailure: (_error, attempt, retryMs) => failed.push(attempt, retryMs),
        onRecovery: (count) => recovered.push(count),
      },
    );
    expect(runs).toBe(2);
    expect(failed).toEqual([1, 375]);
    expect(recovered).toEqual([1]);
  });

  it("stops during retry backoff without starting another operation", async () => {
    const controller = new AbortController();
    let runs = 0;
    const running = runRecoveringLoop(
      controller.signal,
      async () => {
        runs += 1;
        throw new Error("dependency down");
      },
      { idleMs: 10, random: () => 0, onFailure: () => controller.abort() },
    );
    await running;
    expect(runs).toBe(1);
  });
});
