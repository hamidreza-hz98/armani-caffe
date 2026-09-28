import "server-only";

import type { ClientSession, Connection } from "mongoose";

import { createCustomerSecurity, readCustomerCookie } from "../../modules/auth/server.ts";
import { createCartHttpHandler, createCartService } from "../../modules/carts/server.ts";
import { productPricingProjection } from "../../modules/catalog/products/server.ts";
import { productStockProjection } from "../../modules/inventory/server.ts";
import { getDatabaseConnection } from "../database/connection.ts";
import { getServerConfig } from "../secrets/config.ts";

export function composeCartService(
  connection: Connection,
  key: string,
  now: () => Date = () => new Date(),
) {
  const security = createCustomerSecurity(connection, key, now);
  return createCartService(
    connection,
    {
      authorize: (token, tx) => security.store.authorize(token, tx),
      catalog: async (ids, tx) => {
        const session = tx as ClientSession;
        const catalog = await productPricingProjection(connection, ids, session);
        const stock = await productStockProjection(connection, session, ids);
        return new Map(
          [...catalog].map(([id, product]) => [
            id,
            {
              ...product,
              available: product.available && (stock.get(id)?.orderable ?? false),
              stock: stock.get(id)?.availability ?? [],
            },
          ]),
        );
      },
    },
    now,
  );
}
export const handleCartHttp = createCartHttpHandler({
  service: async () =>
    composeCartService(await getDatabaseConnection(), getServerConfig().auth.sessionSecret),
  token: (request) => readCustomerCookie(request, getServerConfig().mode === "production"),
  origins: () => [new URL(getServerConfig().appUrl).origin],
});
