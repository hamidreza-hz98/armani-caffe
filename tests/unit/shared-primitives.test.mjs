import assert from "node:assert/strict";
import test from "node:test";

import {
  addMoney,
  ApplicationError,
  err,
  ok,
  pagination,
  parseEntityId,
  parseUtcTimestamp,
  requirePermission,
  rial,
  subtractMoney,
  utcNow,
} from "../../src/shared/index.ts";

test("IDs, money, and pagination reject invalid values", () => {
  assert.equal(parseEntityId("ABCDEF012345ABCDEF012345"), "abcdef012345abcdef012345");
  assert.throws(() => parseEntityId("not-an-id"));
  assert.deepEqual(addMoney(rial(10), rial(5)), rial(15));
  assert.deepEqual(subtractMoney(rial(10), rial(5)), rial(5));
  assert.throws(() => rial(0.5));
  assert.throws(() => subtractMoney(rial(5), rial(10)));
  assert.deepEqual(pagination(3, 20), { page: 3, pageSize: 20, skip: 40 });
  assert.throws(() => pagination(0));
  assert.throws(() => pagination(1, 101));
});

test("UTC date handling and result values are deterministic", () => {
  const fixed = "2025-01-01T00:00:00.000Z";
  assert.equal(
    utcNow(() => new Date(fixed)),
    fixed,
  );
  assert.equal(parseUtcTimestamp(fixed).toISOString(), fixed);
  assert.throws(() => parseUtcTimestamp("2025-01-01"));
  assert.deepEqual(ok(3), { ok: true, value: 3 });
  assert.deepEqual(err("no"), { ok: false, error: "no" });
});

test("authorization fails closed for missing actors or permissions", () => {
  const actor = {
    id: parseEntityId("abcdef012345abcdef012345"),
    permissions: new Set(["orders:read"]),
  };
  assert.equal(requirePermission(actor, "orders:read"), actor);
  assert.throws(
    () => requirePermission(null, "orders:read"),
    (error) => error instanceof ApplicationError && error.code === "UNAUTHORIZED",
  );
  assert.throws(
    () => requirePermission(actor, "orders:write"),
    (error) => error instanceof ApplicationError && error.code === "FORBIDDEN",
  );
});
