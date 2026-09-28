import { adminPassword, adminUsername } from "../../../shared/admin-input.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { normalizeIranianMobile } from "../../../shared/phone.ts";

export function adminRecord(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new ApplicationError("VALIDATION", "Invalid admin input");
  return input as Record<string, unknown>;
}
export function adminId(input: unknown): string {
  if (typeof input !== "string" || !/^[a-f0-9]{24}$/.test(input))
    throw new ApplicationError("VALIDATION", "Invalid admin ID");
  return input;
}
function fields(input: Record<string, unknown>) {
  if (
    typeof input.displayName !== "string" ||
    !input.displayName.trim() ||
    input.displayName.length > 120 ||
    /[<>\u0000-\u001f\u007f]/u.test(input.displayName)
  )
    throw new ApplicationError("VALIDATION", "Invalid display name");
  let phone: string;
  try {
    phone = normalizeIranianMobile(input.phone as string);
  } catch {
    throw new ApplicationError("VALIDATION", "Invalid admin phone");
  }
  if (input.role !== "OWNER" && input.role !== "CASHIER")
    throw new ApplicationError("VALIDATION", "Invalid admin role");
  return {
    username: adminUsername(input.username),
    displayName: input.displayName.trim().normalize("NFC"),
    phone,
    role: input.role as "OWNER" | "CASHIER",
  };
}
export function parseAdminCreate(input: unknown) {
  const row = adminRecord(input, ["username", "displayName", "phone", "role", "password"]);
  return { ...fields(row), password: adminPassword(row.password) };
}
export function parseAdminUpdate(input: unknown) {
  const row = adminRecord(input, [
    "username",
    "displayName",
    "phone",
    "role",
    "status",
    "revision",
  ]);
  if (
    (row.status !== "active" && row.status !== "disabled") ||
    !Number.isSafeInteger(row.revision) ||
    (row.revision as number) < 0 ||
    (row.revision as number) >= Number.MAX_SAFE_INTEGER
  )
    throw new ApplicationError("VALIDATION", "Invalid admin status or revision");
  return {
    ...fields(row),
    status: row.status as "active" | "disabled",
    revision: row.revision as number,
  };
}
export type AdminCreate = ReturnType<typeof parseAdminCreate>;
export type AdminUpdate = ReturnType<typeof parseAdminUpdate>;
