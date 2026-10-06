import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { adminCookieName } from "@/modules/auth/domain/admin-session";
import { customerCookieName } from "@/modules/auth/domain/customer-session";
import {
  parseCustomerLogin,
  parseCustomerProfileUpdate,
  parseCustomerSignup,
} from "@/modules/customers";
import { customerSchema } from "@/modules/customers/server";
import { canonicalBirthDate, gregorianToJalali, jalaliToGregorian } from "@/shared/jalali-date";

describe("customer auth contracts", () => {
  it("normalizes Iranian mobile inputs and excludes unexpected fields", () => {
    expect(
      parseCustomerSignup({ phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹", displayName: "مشتری" }).phone,
    ).toBe("+989123456789");
    expect(parseCustomerLogin({ phone: "00989123456789", code: "123456" }).phone).toBe(
      "+989123456789",
    );
    expect(() => parseCustomerSignup({ phone: "09123456789", password: "legacy" })).toThrow();
    expect(() =>
      parseCustomerSignup({ phone: "09123456789", displayName: "مشتری", role: "OWNER" }),
    ).toThrow();
    expect(() => parseCustomerLogin({ phone: "09123456789", code: "bad" })).toThrow();
    expect(() => parseCustomerProfileUpdate({ revision: 0, phone: "09123456789" })).toThrow();
  });
  it("round-trips canonical UTC birth dates through Jalali UI adapters", () => {
    for (const gregorian of ["1980-02-29", "2000-03-20", "2026-09-28"])
      expect(jalaliToGregorian(gregorianToJalali(gregorian))).toBe(gregorian);
    expect(canonicalBirthDate("2000-03-20")).toBe("2000-03-20");
    expect(() => canonicalBirthDate("2000-02-30")).toThrow();
    expect(() => jalaliToGregorian("1402-12-30")).toThrow();
    expect(gregorianToJalali("2024-03-19")).toBe("1402-12-29");
    expect(gregorianToJalali("2024-03-20")).toBe("1403-01-01");
    expect(() => jalaliToGregorian("1199-12-29")).toThrow();
    expect(() => jalaliToGregorian("1600-01-01")).toThrow();
    expect(adminCookieName(true)).not.toBe(customerCookieName(true));
  });
  it("schema rejects non-midnight stored birth dates", async () => {
    const Customer =
      mongoose.models.CustomerBirthDateTest ??
      mongoose.model("CustomerBirthDateTest", customerSchema);
    const values = { phone: "09123456789", status: "active" };
    await expect(
      new Customer({ ...values, birthDate: new Date("2000-03-20T00:00:00.000Z") }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new Customer({ ...values, birthDate: new Date("2000-03-20T12:00:00.000Z") }).validate(),
    ).rejects.toThrow();
  });
});
