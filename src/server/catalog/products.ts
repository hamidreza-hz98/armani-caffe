import "server-only";

import { randomUUID } from "node:crypto";

import type { Connection } from "mongoose";

import { appendAudit } from "../../modules/audit/server.ts";
import { adminTokenFromRequest, configuredAdminSecurity } from "../../modules/auth/server.ts";
import {
  publicProductCategories,
  validateProductCategory,
} from "../../modules/catalog/categories/server.ts";
import {
  createProductHttpHandler,
  createProductService,
} from "../../modules/catalog/products/server.ts";
import { createInventoryService, productStockProjection } from "../../modules/inventory/server.ts";
import { syncProductMediaReferences } from "../../modules/media/server.ts";
import { appendOutbox } from "../../modules/notifications/server.ts";
import { productSoldCounts } from "../../modules/orders/server.ts";
import type { AdminAuthorizer } from "../../shared/security-ports.ts";
import { getDatabaseConnection } from "../database/connection.ts";
import { getServerConfig } from "../secrets/config.ts";
/** Cross-module composition lives outside modules to avoid category/media ↔ product import cycles. */
export function composeProductService(
  connection: Connection,
  authorize: AdminAuthorizer,
  now: () => Date = () => new Date(),
) {
  const inventory = createInventoryService(connection, authorize, now).repository;
  return createProductService(
    connection,
    authorize,
    {
      category: (tx, id, published) => validateProductCategory(connection, tx, id, published),
      categories: (tx) => publicProductCategories(connection, tx),
      media: (tx, id, old, next, oldAdd, nextAdd) =>
        syncProductMediaReferences(connection, tx, id, old, next, oldAdd, nextAdd, now()),
      rules: (tx, id, rules) => inventory.replaceConsumptionRules(tx, id, rules),
      stock: (tx, ids) => productStockProjection(connection, tx, ids),
      sold: (tx, ids) => productSoldCounts(connection, tx, ids),
      record: async (session, actorId, action, id, requestId) => {
        const actor = { kind: "admin" as const, id: actorId },
          key = "product:" + randomUUID();
        await appendAudit(
          connection,
          session,
          {
            actor,
            area: "catalog",
            action,
            subject: { kind: "product", id },
            requestId,
            idempotencyKey: key,
            metadata: {},
          },
          now(),
        );
        await appendOutbox(
          connection,
          session,
          [
            {
              actor,
              aggregateKind: "product",
              aggregateId: id,
              eventType: action,
              payload: { productId: id },
              requestId,
              idempotencyKey: key,
            },
            {
              actor,
              aggregateKind: "catalog",
              aggregateId: "products",
              eventType: "catalog.products.changed",
              payload: { productId: id },
              requestId,
              idempotencyKey: key + ":invalidate",
            },
          ],
          now(),
        );
      },
    },
    now,
  );
}
export async function configuredProductService() {
  return composeProductService(await getDatabaseConnection(), async (token, capability, tx) =>
    (await configuredAdminSecurity()).store.authorize(token, capability, tx),
  );
}
export const handleProductHttp = createProductHttpHandler({
  service: configuredProductService,
  token: adminTokenFromRequest,
  origins: () => {
    const config = getServerConfig();
    return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
  },
});
