import "server-only";

import { getServerConfig } from "@/server/secrets/config";

export function canonicalStorefrontUrl(): URL {
  return new URL("/", getServerConfig().appUrl);
}
