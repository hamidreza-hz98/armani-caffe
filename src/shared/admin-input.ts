import { ApplicationError } from "./errors.ts";

const usernamePattern = /^[a-z][a-z0-9._-]{2,39}$/u;
const mobileUsernamePattern = /^09[0-9]{9}$/u;
const emailPattern =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z][a-z0-9-]{1,23})+$/u;

export function validAdminUsername(value: string): boolean {
  return (
    value.length <= 80 &&
    !value.includes("..") &&
    (usernamePattern.test(value) || emailPattern.test(value) || mobileUsernamePattern.test(value))
  );
}

export function adminUsername(input: unknown): string {
  if (typeof input !== "string" || input.length > 80)
    throw new ApplicationError("VALIDATION", "Invalid username");
  const value = input.trim().toLowerCase();
  if (!validAdminUsername(value)) throw new ApplicationError("VALIDATION", "Invalid username");
  return value;
}
export function adminPassword(input: unknown, creation = true): string {
  if (
    typeof input !== "string" ||
    [...input].length < (creation ? 15 : 1) ||
    [...input].length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(input)
  )
    throw new ApplicationError("VALIDATION", "Invalid password");
  return input;
}
