import "server-only";

// Server public boundary. Compose use cases and adapters here.
import type { Connection } from "mongoose";

import { getDatabaseConnection } from "../../server/database/connection.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import { commitSensitiveChange } from "../notifications/server.ts";
import { SettingsService } from "./application/service.ts";
import { createSettingsHttpHandler } from "./infrastructure/http.ts";
import { MongoSettingsRepository, type SettingsCommit } from "./infrastructure/repository.ts";
import { SettingsVault } from "./infrastructure/vault.ts";

export { SettingsService } from "./application/service.ts";
export { createSettingsHttpHandler } from "./infrastructure/http.ts";
export { settingsReceiptSchema, settingsSchema } from "./infrastructure/schema.ts";
export { SettingsVault } from "./infrastructure/vault.ts";

export function createSettingsRepository(
  connection: Connection,
  vault: SettingsVault,
  now: () => Date = () => new Date(),
) {
  const commit: SettingsCommit = (change, operation) => {
    const actor = { kind: "admin" as const, id: change.actor.id };
    return commitSensitiveChange(
      connection,
      {
        audit: {
          actor,
          area: "settings",
          action: change.rotate ? "settings.rotated" : "settings.updated",
          subject: { kind: "settings", id: change.kind },
          requestId: change.requestId,
          idempotencyKey: change.idempotencyKey,
          metadata: {
            kind: change.kind,
            previousRevision: change.revision,
            revision: change.revision + 1,
          },
        },
        events: [
          {
            actor,
            aggregateKind: "settings",
            aggregateId: change.kind,
            eventType: "settings.updated",
            payload: { kind: change.kind, revision: change.revision + 1 },
            requestId: change.requestId,
            idempotencyKey: change.idempotencyKey,
          },
        ],
        change: operation,
      },
      now,
    );
  };
  return new MongoSettingsRepository(connection, vault, commit, now);
}
let singleton: SettingsService | undefined;
let singletonConnection: Connection | undefined;
export async function createSettingsService(): Promise<SettingsService> {
  const config = getServerConfig(),
    connection = await getDatabaseConnection();
  if (!singleton || singletonConnection !== connection) {
    singleton = new SettingsService(
      createSettingsRepository(
        connection,
        new SettingsVault(config.encryption.key, config.encryption.previousKey),
      ),
      config.mode === "production",
    );
    singletonConnection = connection;
  }
  return singleton;
}

// Fail closed until Task 14 provides the verified admin-session resolver.
export const handleSettingsHttp = createSettingsHttpHandler({
  service: createSettingsService,
  authenticate: async () => null,
  origins: () => {
    const config = getServerConfig();
    return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
  },
});
