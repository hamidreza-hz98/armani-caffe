export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new RangeError("Attempt must be positive");
  const jitter = random();
  if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1)
    throw new RangeError("Random value must be in [0, 1)");
  const capped = Math.min(300_000, 1000 * 2 ** Math.min(attempt - 1, 18));
  return Math.round(capped * (0.75 + 0.5 * jitter));
}
