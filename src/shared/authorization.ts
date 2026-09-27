import { ApplicationError } from "./errors.ts";
import type { EntityId } from "./id.ts";

export type Actor = Readonly<{ id: EntityId; permissions: ReadonlySet<string> }>;

export function requirePermission(actor: Actor | null, permission: string): Actor {
  if (!actor) throw new ApplicationError("UNAUTHORIZED", "Authentication is required");
  if (!actor.permissions.has(permission)) {
    throw new ApplicationError("FORBIDDEN", "Permission is required");
  }
  return actor;
}
