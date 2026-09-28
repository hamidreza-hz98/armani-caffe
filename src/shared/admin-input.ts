import { ApplicationError } from "./errors.ts";

export function adminUsername(input: unknown): string {
  if (typeof input !== "string" || input.length > 80)
    throw new ApplicationError("VALIDATION", "Invalid username");
  const value = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,39}$/.test(value))
    throw new ApplicationError("VALIDATION", "Invalid username");
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
