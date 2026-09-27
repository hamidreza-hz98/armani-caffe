import { expect, test } from "vitest";

import {
  customerFactory,
  fixedClock,
  isolatedResources,
  sequentialObjectIds,
} from "../fixtures/isolation.ts";

test("test factories and clocks are deterministic while resource names are isolated", () => {
  const resources = isolatedResources("orders", "run-123");
  expect(resources.databaseName).toBe("armani_test_ordersrun123");
  expect(resources.redisPrefix).toBe("armani:test:ordersrun123:");
  expect(resources.minioBucket).toBe("armani-test-ordersrun123");
  const clock = fixedClock();
  expect(clock()).toEqual(clock());
  const nextId = sequentialObjectIds();
  expect(nextId()).toBe("000000000000000000000001");
  expect(nextId()).toBe("000000000000000000000002");
  expect(customerFactory({ name: "Override" }).name).toBe("Override");
});
