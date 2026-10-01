import { expect, test } from "vitest";

import {
  checkoutIdempotencyKey,
  composePickupNotes,
  parsePickupNotes,
} from "../../src/storefront/pickup-notes.ts";

test("pickup request round-trips through immutable order notes", () => {
  for (const choice of ["asap", "30", "60"] as const) {
    const notes = composePickupNotes(choice, "کم‌شیرین\nتماس قبل از مراجعه");
    expect(parsePickupNotes(notes)).toEqual({
      choice,
      customerNote: "کم‌شیرین\nتماس قبل از مراجعه",
    });
    expect(notes).not.toContain("delivery");
  }
});

test("older free-form cart notes remain visible when no pickup marker exists", () => {
  expect(parsePickupNotes("یادداشت قبلی")).toEqual({
    choice: "asap",
    customerNote: "یادداشت قبلی",
  });
});

test("checkout key is deterministic across refreshes and changes with server revision", () => {
  const id = "a".repeat(24);
  expect(checkoutIdempotencyKey(id, 12)).toBe(checkoutIdempotencyKey(id, 12));
  expect(checkoutIdempotencyKey(id, 12)).not.toBe(checkoutIdempotencyKey(id, 13));
  expect(() => checkoutIdempotencyKey("invalid", 12)).toThrow();
});
