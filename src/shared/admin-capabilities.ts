import { ApplicationError } from "./errors.ts";

export const adminCapabilities = [
  "admin.access",
  "admins.read",
  "admins.manage",
  "media.read",
  "media.manage",
  "settings.read",
  "settings.manage",
  "settings.seo.read",
  "settings.sensitive.read",
  "catalog.read",
  "catalog.manage",
  "customers.read",
  "customers.manage",
  "orders.read",
  "orders.manage",
  "inventory.read",
  "inventory.request",
  "inventory.approve",
  "invoices.read",
  "invoices.reprint",
  "printing.read",
  "printing.manage",
  "analytics.read",
  "audit.read",
] as const;
export type AdminCapability = (typeof adminCapabilities)[number];
export type AdminActor = Readonly<{ id: string; role: "OWNER" | "CASHIER" }>;
export const adminCapabilityMap: Readonly<Record<AdminActor["role"], readonly AdminCapability[]>> =
  Object.freeze({
    OWNER: Object.freeze([...adminCapabilities]),
    CASHIER: Object.freeze([
      "admin.access",
      "media.read",
      "settings.read",
      "catalog.read",
      "customers.read",
      "orders.read",
      "orders.manage",
      "inventory.read",
      "inventory.request",
      "invoices.read",
      "invoices.reprint",
      "printing.read",
    ] as AdminCapability[]),
  });
export function requireAdminCapability<T extends AdminActor>(
  actor: T | null,
  capability: AdminCapability,
): T {
  if (!actor) throw new ApplicationError("UNAUTHORIZED", "Authentication required");
  if (
    !/^[a-f0-9]{24}$/.test(actor.id) ||
    !Object.hasOwn(adminCapabilityMap, actor.role) ||
    !adminCapabilityMap[actor.role].includes(capability)
  )
    throw new ApplicationError("FORBIDDEN", "Capability required");
  return actor;
}
