import "server-only";

import { cookies } from "next/headers";

import { customerCookieName, validCustomerToken } from "@/modules/auth";
import { configuredCustomerSecurity } from "@/modules/auth/server";
import { settingsDefaults } from "@/modules/settings";
import { createSettingsService } from "@/modules/settings/server";
import { composeCartService } from "@/server/commerce/carts";
import { getDatabaseConnection } from "@/server/database/connection";
import { getServerConfig } from "@/server/secrets/config";

import { contactLinks } from "./contact-links";

export type StorefrontShellData = {
  businessName: string;
  businessLogoUrl?: string;
  account: { state: "guest" | "customer" | "unavailable"; name: string | null };
  cartCount: number | null;
  contacts: ReturnType<typeof contactLinks>;
  contactAddress: string;
  settingsAvailable: boolean;
};

export async function storefrontIsGuest(): Promise<boolean> {
  const config = getServerConfig();
  const cookie = (await cookies()).get(customerCookieName(config.mode === "production"))?.value;
  return !validCustomerToken(cookie);
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Storefront data timed out")), 2500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadStorefrontShell(): Promise<StorefrontShellData> {
  const config = getServerConfig();
  const cookie = (await cookies()).get(customerCookieName(config.mode === "production"))?.value;
  const token = validCustomerToken(cookie) ? cookie : null;
  const [settingsResult, accountResult] = await Promise.allSettled([
    bounded(createSettingsService().then((service) => service.publicSettings())),
    token
      ? bounded(
          configuredCustomerSecurity().then(async ({ auth }) => {
            const principal = await auth.resolve(token);
            if (!principal) return { state: "guest" as const, name: null, cartCount: 0 };
            const [profile, cart] = await Promise.allSettled([
              auth.profile(token),
              getDatabaseConnection().then((connection) =>
                composeCartService(connection, config.auth.sessionSecret).read(token),
              ),
            ]);
            return {
              state: "customer" as const,
              name: profile.status === "fulfilled" ? profile.value.displayName : null,
              cartCount:
                cart.status === "fulfilled"
                  ? cart.value.items.reduce((total, item) => total + item.quantity, 0)
                  : null,
            };
          }),
        )
      : Promise.resolve({ state: "guest" as const, name: null, cartCount: 0 }),
  ]);
  const business =
    settingsResult.status === "fulfilled"
      ? settingsResult.value.business
      : settingsDefaults("business");
  const contact = settingsResult.status === "fulfilled" ? settingsResult.value.contact : null;
  return {
    businessName: business.title,
    businessLogoUrl: business.logoMediaId
      ? `/api/media/${business.logoMediaId}/file?variant=small`
      : "/brand/armani-logo.png",
    account:
      accountResult.status === "fulfilled"
        ? accountResult.value
        : { state: "unavailable", name: null },
    cartCount: accountResult.status === "fulfilled" ? accountResult.value.cartCount : null,
    contacts: contact ? contactLinks(contact) : [],
    contactAddress: contact?.address ?? "",
    settingsAvailable: settingsResult.status === "fulfilled",
  };
}
