import { expect, test } from "vitest";

import { retryDelayMs } from "@/modules/notifications";

test("retry delay uses capped exponential backoff and bounded jitter", () => {
  expect(retryDelayMs(1, () => 0.5)).toBe(1000);
  expect(retryDelayMs(2, () => 0.5)).toBe(2000);
  expect(retryDelayMs(20, () => 0.5)).toBe(300000);
  expect(retryDelayMs(1, () => 0)).toBe(750);
  expect(() => retryDelayMs(0)).toThrow(RangeError);
  expect(() => retryDelayMs(1, () => 1)).toThrow(RangeError);
});
