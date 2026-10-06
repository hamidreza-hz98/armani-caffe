import { expect, test } from "vitest";

import { validateAuthFields } from "../../src/storefront/customer-auth-client.ts";

const fields = {
  phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹",
  firstName: "سارا",
  lastName: "احمدی",
  birthYear: "1400",
  birthMonth: "1",
  birthDay: "1",
};

test("signup normalizes mobile and converts Jalali date only at UI boundary", () => {
  const result = validateAuthFields("signup", fields);
  expect(result.errors).toEqual({});
  expect(result.input).toMatchObject({ phone: "+989123456789", birthDate: "2021-03-21" });
});

test("invalid mobile, first name, last name, and Jalali date are field errors", () => {
  const result = validateAuthFields("signup", {
    ...fields,
    phone: "0999",
    firstName: " ",
    lastName: "",
    birthDay: "31",
    birthMonth: "12",
  });
  expect(Object.keys(result.errors)).toEqual(["phone", "firstName", "lastName", "birthDay"]);
});

test("login does not require signup-only fields", () => {
  const result = validateAuthFields("login", { ...fields, firstName: "", lastName: "", birthDay: "" });
  expect(result.errors).toEqual({});
  expect(result.input).toMatchObject({ phone: "+989123456789" });
});
