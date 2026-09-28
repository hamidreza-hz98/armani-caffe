export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000;
export const adminCookieName = (production: boolean) =>
  production ? "__Host-armani-admin" : "armani-admin-dev";
export const customerCookieName = (production: boolean) =>
  production ? "__Host-armani-customer" : "armani-customer-dev";
export const validAdminToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export type AdminPrincipal = Readonly<{
  id: string;
  role: "OWNER" | "CASHIER";
  username: string;
  displayName: string;
  sessionId: string;
  expiresAt: string;
}>;
