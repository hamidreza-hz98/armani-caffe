import { describe, expect, it } from "vitest";

import { formatJalaliDate, formatPersianNumber, formatToman } from "@/theme/format";
import { colors, minimumTouchTarget, shape } from "@/theme/tokens";

describe("Persian design foundation", () => {
  it("uses the approved palette and accessible control geometry", () => {
    expect(colors.canvas).toBe("#F7F2EA");
    expect(colors.brown).toBe("#3A2418");
    expect(minimumTouchTarget).toBeGreaterThanOrEqual(44);
    expect(shape.card).toBeGreaterThan(shape.control);
  });

  it("formats numbers and integer Toman prices in Persian", () => {
    expect(formatPersianNumber(12345)).toBe("۱۲٬۳۴۵");
    expect(formatPersianNumber(12.345, 1)).toBe("۱۲٫۳");
    expect(formatToman(185000)).toBe("۱۸۵٬۰۰۰ تومان");
    expect(() => formatToman(1.5)).toThrow(RangeError);
    expect(() => formatPersianNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("formats a UTC instant as a Jalali date in Tehran", () => {
    expect(formatJalaliDate("2026-09-27T12:00:00Z")).toContain("۱۴۰۵");
    expect(() => formatJalaliDate("invalid")).toThrow(RangeError);
  });
});
