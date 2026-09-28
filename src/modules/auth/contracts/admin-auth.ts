import { adminPassword, adminUsername } from "../../../shared/admin-input.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export { adminPassword, adminUsername } from "../../../shared/admin-input.ts";

export function authRecord(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new ApplicationError("VALIDATION", "Invalid authentication input");
  return input as Record<string, unknown>;
}
export function parseAdminLogin(input: unknown) {
  const row = authRecord(input, ["username", "password"]);
  return { username: adminUsername(row.username), password: adminPassword(row.password, false) };
}
