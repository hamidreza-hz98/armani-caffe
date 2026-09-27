import type { EntityDto } from "../../../shared/domain.ts";

export const adminRoles = ["OWNER", "CASHIER"] as const;
export type AdminRole = (typeof adminRoles)[number];
export type AdminStatus = "active" | "disabled";
export type Admin = EntityDto &
  Readonly<{ phone: string; displayName: string; role: AdminRole; status: AdminStatus }>;

export function assertAdminRole(role: string): asserts role is AdminRole {
  if (!adminRoles.includes(role as AdminRole)) throw new RangeError("Unknown admin role");
}
