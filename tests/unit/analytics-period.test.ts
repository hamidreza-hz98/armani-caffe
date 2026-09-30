import { expect, test } from "vitest";

import { tehranDashboardPeriod } from "@/modules/analytics/domain/period";

test("Tehran local midnight is used over UTC storage, including month boundary", () => {
  const period = tehranDashboardPeriod(new Date("2026-06-01T21:00:00.000Z"));
  expect(period).toMatchObject({ timezone: "Asia/Tehran", localDate: "2026-06-02" });
  expect(period.todayStartUtc.toISOString()).toBe("2026-06-01T20:30:00.000Z");
  expect(period.thirtyDayStartUtc.toISOString()).toBe("2026-05-03T20:30:00.000Z");
});

test("historical Tehran summer offset is derived rather than hard-coded", () => {
  const period = tehranDashboardPeriod(new Date("2021-06-01T20:00:00.000Z"));
  expect(period.localDate).toBe("2021-06-02");
  expect(period.todayStartUtc.toISOString()).toBe("2021-06-01T19:30:00.000Z");
});

test("invalid clocks fail rather than producing a misleading dashboard", () => {
  expect(() => tehranDashboardPeriod(new Date("invalid"))).toThrow();
});
