export const CUSTOMER_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_IDLE_MS = CUSTOMER_SESSION_TTL_MS;
export const customerCookieName = (production: boolean) =>
  production ? "__Host-armani-customer" : "armani-customer-dev";
export const validCustomerToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export type CustomerPrincipal = Readonly<{
  id: string;
  phone: string;
  sessionId: string;
  expiresAt: string;
}>;
