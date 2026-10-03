import "server-only";

import type { ProviderFactory } from "../../modules/payments/server.ts";

/** Add only documented, implemented gateway adapters here. The placeholder is not selectable. */
export const gatewayFactories = new Map<string, ProviderFactory>();

export function installedGatewayIds(): string[] {
  return [...gatewayFactories.keys()].sort();
}
