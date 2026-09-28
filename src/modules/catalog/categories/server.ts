import "server-only";

import { randomUUID } from "node:crypto";

import type { ClientSession, Connection } from "mongoose";

import { getDatabaseConnection } from "../../../server/database/connection.ts";
import { getServerConfig } from "../../../server/secrets/config.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { AdminAuthorizer, SecurityCommit } from "../../../shared/security-ports.ts";
import { adminTokenFromRequest, configuredAdminSecurity } from "../../auth/server.ts";
import { syncCategoryMediaReference } from "../../media/server.ts";
import { commitSensitiveChange } from "../../notifications/server.ts";
import { productCategoryDependencies } from "../products/server.ts";
import { CategoryService } from "./application/service.ts";
import { createCategoryHttpHandler } from "./infrastructure/http.ts";
import { MongoCategoryRepository } from "./infrastructure/repository.ts";

export { CategoryService } from "./application/service.ts";
export { createCategoryHttpHandler } from "./infrastructure/http.ts";
export {
  publicProductCategories,
  validateProductCategory,
} from "./infrastructure/product-reference.ts";
export { MongoCategoryRepository } from "./infrastructure/repository.ts";
export { categoryOrderGuardSchema, categorySchema } from "./infrastructure/schema.ts";

export function createCategoryService(
  connection: Connection,
  authorize: AdminAuthorizer,
  now: () => Date = () => new Date(),
) {
  const commit: SecurityCommit = async (change, operation) => {
    const idempotencyKey = `category:${randomUUID()}`;
    try {
      return await commitSensitiveChange(
        connection,
        {
          audit: {
            actor: change.actor,
            area: "catalog",
            action: change.action,
            subject: { kind: "category", id: change.subjectId },
            requestId: change.requestId,
            idempotencyKey,
            metadata: {},
          },
          events: [
            {
              actor: change.actor,
              aggregateKind: "category",
              aggregateId: change.subjectId,
              eventType: change.action,
              payload: { categoryId: change.subjectId },
              requestId: change.requestId,
              idempotencyKey,
            },
            {
              actor: change.actor,
              aggregateKind: "catalog",
              aggregateId: "categories",
              eventType: "catalog.categories.changed",
              payload: { scope: "categories" },
              requestId: change.requestId,
              idempotencyKey: `${idempotencyKey}:invalidate`,
            },
          ],
          change: (tx) => operation(tx),
        },
        now,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError("CONFLICT", "Category uniqueness conflict");
      throw new ApplicationError("UNAVAILABLE", "Category transaction failed");
    }
  };
  return new CategoryService(
    new MongoCategoryRepository(
      connection,
      authorize,
      commit,
      (tx, id, oldId, nextId) =>
        syncCategoryMediaReference(connection, tx as ClientSession, id, oldId, nextId, now()),
      (tx, id) => productCategoryDependencies(connection, tx as ClientSession, id),
      now,
    ),
  );
}
export async function configuredCategoryService() {
  const connection = await getDatabaseConnection();
  return createCategoryService(connection, async (token, capability, tx) =>
    (await configuredAdminSecurity()).store.authorize(token, capability, tx),
  );
}
export const handleCategoryHttp = createCategoryHttpHandler({
  service: configuredCategoryService,
  token: adminTokenFromRequest,
  origins: () => {
    const config = getServerConfig();
    return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
  },
});
