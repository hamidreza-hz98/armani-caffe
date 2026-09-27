import { randomUUID } from "node:crypto";

const safe = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);

export function isolatedResources(label = "test", token: string = randomUUID()) {
  const suffix = `${safe(label)}${safe(token)}`.slice(0, 32);
  if (!suffix) throw new Error("Test resource suffix is required");
  return Object.freeze({
    databaseName: `armani_test_${suffix}`,
    redisPrefix: `armani:test:${suffix}:`,
    minioBucket: `armani-test-${suffix}`,
  });
}

export function fixedClock(iso = "2025-01-01T00:00:00.000Z") {
  const timestamp = new Date(iso);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid fixed test clock");
  return () => new Date(timestamp);
}

export function sequentialObjectIds(start = 1) {
  let next = start;
  return () => (next++).toString(16).padStart(24, "0");
}

export function customerFactory(
  overrides: Partial<{ _id: string; phone: string; name: string }> = {},
) {
  return {
    _id: "000000000000000000000001",
    phone: "+989123456789",
    name: "Test Customer",
    ...overrides,
  };
}
