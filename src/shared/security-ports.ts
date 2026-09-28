import type { AdminActor, AdminCapability } from "./admin-capabilities.ts";

/** Opaque server unit-of-work context. Never a browser/API contract. */
export type TransactionContext = object;
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string | null): Promise<boolean>;
}
export type AdminAuthorizer = (
  token: string | null,
  capability: AdminCapability,
  transaction?: TransactionContext,
) => Promise<AdminActor>;
export type SecurityChange = {
  actor: { kind: "admin" | "system"; id: string | null };
  action: string;
  subjectId: string;
  requestId: string;
  metadata?: Record<string, string | number | boolean | null>;
};
export type SecurityCommit = <T>(
  change: SecurityChange,
  operation: (transaction: TransactionContext) => Promise<T>,
) => Promise<T>;
