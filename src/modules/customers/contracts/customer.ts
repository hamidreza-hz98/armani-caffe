import { ApplicationError } from "../../../shared/errors.ts";
import { canonicalBirthDate } from "../../../shared/jalali-date.ts";
import { normalizeIranianMobile } from "../../../shared/phone.ts";

function record(input: unknown, fields: readonly string[]) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new ApplicationError("VALIDATION", "Invalid customer input");
  return input as Record<string, unknown>;
}
export function customerPhone(input: unknown): string {
  try {
    if (typeof input !== "string" || input.length > 32) throw new Error();
    return normalizeIranianMobile(input);
  } catch {
    throw new ApplicationError("VALIDATION", "Invalid mobile number");
  }
}
function name(input: unknown): string | null {
  if (input === null) return null;
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 120 ||
    /[<>\u0000-\u001f\u007f]/u.test(input)
  )
    throw new ApplicationError("VALIDATION", "Invalid display name");
  return input.trim().normalize("NFC");
}
function birthDate(input: unknown) {
  try {
    return canonicalBirthDate(input);
  } catch {
    throw new ApplicationError("VALIDATION", "Invalid birth date");
  }
}
export function parseCustomerSignup(input: unknown) {
  const row = record(input, ["phone", "displayName", "birthDate", "code"]);
  const proof = row.code;
  if (
    proof !== undefined &&
    (typeof proof !== "string" || !/^\d{6}$/u.test(proof))
  )
    throw new ApplicationError("VALIDATION", "Invalid verification code");
  return {
    phone: customerPhone(row.phone),
    ...(proof === undefined ? {} : { proof }),
    displayName: row.displayName === undefined ? null : name(row.displayName),
    birthDate: row.birthDate === undefined ? null : birthDate(row.birthDate),
  };
}
export function parseCustomerLogin(input: unknown) {
  const row = record(input, ["phone", "code"]);
  if (typeof row.code !== "string" || !/^\d{6}$/u.test(row.code))
    throw new ApplicationError("VALIDATION", "Invalid verification code");
  return { phone: customerPhone(row.phone), proof: row.code };
}
export function parseCustomerProfileUpdate(input: unknown) {
  const row = record(input, ["displayName", "birthDate", "revision"]);
  if (
    !Number.isSafeInteger(row.revision) ||
    (row.revision as number) < 0 ||
    (row.revision as number) >= Number.MAX_SAFE_INTEGER ||
    (row.displayName === undefined && row.birthDate === undefined)
  )
    throw new ApplicationError("VALIDATION", "Invalid profile update");
  return {
    revision: row.revision as number,
    ...(row.displayName === undefined ? {} : { displayName: name(row.displayName) }),
    ...(row.birthDate === undefined ? {} : { birthDate: birthDate(row.birthDate) }),
  };
}
