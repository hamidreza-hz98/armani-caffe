export const OPEN_CUSTOMER_AUTH = "armani:open-customer-auth";
export const CUSTOMER_AUTHENTICATED = "armani:customer-authenticated";
export const CUSTOMER_LOGGED_OUT = "armani:customer-logged-out";

export function openCustomerAuth(mode: "login" | "signup" = "login") {
  window.dispatchEvent(new CustomEvent(OPEN_CUSTOMER_AUTH, { detail: mode }));
}
