import "server-only";

import { randomUUID } from "node:crypto";

import type { Connection } from "mongoose";

import { getDatabaseConnection } from "../../server/database/connection.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import type { AdminAuthorizer } from "../../shared/security-ports.ts";
import { appendAudit } from "../audit/server.ts";
import { adminTokenFromRequest, configuredAdminSecurity } from "../auth/server.ts";
import { appendOutbox } from "../notifications/server.ts";
import { InventoryService } from "./application/service.ts";
import { createInventoryHttpHandler } from "./infrastructure/http.ts";
import { type InventoryRecord, MongoInventoryRepository } from "./infrastructure/repository.ts";

export { InventoryService } from "./application/service.ts";
export { createInventoryHttpHandler } from "./infrastructure/http.ts";
export { MongoInventoryRepository } from "./infrastructure/repository.ts";
export function createInventoryService(
  connection: Connection,
  authorize: AdminAuthorizer,
  now: () => Date = () => new Date(),
) {
  const record: InventoryRecord = async (session, actor, action, id, requestId, events = []) => {
    const key = `inventory:${randomUUID()}`;
    await appendAudit(
      connection,
      session,
      {
        actor,
        area: "inventory",
        action,
        subject: { kind: "inventory", id },
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
          aggregateKind: "inventory",
          aggregateId: id,
          eventType: action,
          payload: { entityId: id },
          requestId,
          actor,
          idempotencyKey: key,
        },
        ...events.map((event, index) => ({
          aggregateKind: "inventory",
          aggregateId: id,
          eventType: event.type,
          payload: event.payload,
          requestId,
          actor,
          idempotencyKey: `${key}:${index}`,
        })),
      ],
      now(),
    );
  };
  const repository = new MongoInventoryRepository(connection, authorize, record, now);
  return { service: new InventoryService(repository), repository };
}
export async function configuredInventoryService() {
  return createInventoryService(await getDatabaseConnection(), async (token, capability, tx) =>
    (await configuredAdminSecurity()).store.authorize(token, capability, tx),
  );
}
export const handleInventoryHttp = createInventoryHttpHandler({
  service: async () => (await configuredInventoryService()).service,
  token: adminTokenFromRequest,
  origins: () => {
    const config = getServerConfig();
    return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
  },
});

// Server public boundary. Compose use cases and adapters here.
export {
  inventoryItemSchema,
  inventoryMovementSchema,
  productConsumptionRuleSchema,
  stockApprovalRequestSchema,
} from "./infrastructure/schema.ts";
