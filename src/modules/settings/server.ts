import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Server public boundary. Compose use cases and adapters here.
import type { Connection } from "mongoose";

import { installedGatewayIds } from "../../server/commerce/payment-adapters.ts";
import { getDatabaseConnection } from "../../server/database/connection.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { appendAudit } from "../audit/server.ts";
import { authenticateAdminRequest } from "../auth/server.ts";
import { syncSettingsMediaReferences } from "../media/server.ts";
import { commitSensitiveChange } from "../notifications/server.ts";
import { SettingsService } from "./application/service.ts";
import { renderBrowserTestPrint, type SettingsActor, type SettingsValues } from "./domain/index.ts";
import { createSettingsHttpHandler } from "./infrastructure/http.ts";
import { MongoSettingsRepository, type SettingsCommit } from "./infrastructure/repository.ts";
import { SettingsVault } from "./infrastructure/vault.ts";

export { SettingsService } from "./application/service.ts";
export { createSettingsHttpHandler } from "./infrastructure/http.ts";
export { invoiceIdentitySettings } from "./infrastructure/invoice-identity.ts";
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
  return new MongoSettingsRepository(connection, vault, commit, now, (session, previous, next) =>
    syncSettingsMediaReferences(connection, session, previous, next, now()),
  );
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
      installedGatewayIds(),
    );
    singletonConnection = connection;
  }
  return singleton;
}

// Roles are resolved from verified live admin sessions, never caller-supplied identity.
export const handleSettingsHttp = createSettingsHttpHandler({
  service: createSettingsService,
  authenticate: authenticateAdminRequest,
  origins: () => {
    const config = getServerConfig();
    return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
  },
});

function printSignature(id: string, at: number, actorId: string) {
  return createHmac("sha256", getServerConfig().auth.adminSessionSecret)
    .update(`${id}:${at}:${actorId}:browser-test-print`)
    .digest("hex");
}

export async function requestBrowserTestPrint(
  actor: SettingsActor,
  origin: string | null,
  requestId: string,
) {
  const config = getServerConfig();
  if (![new URL(config.appUrl).origin, new URL(config.adminUrl).origin].includes(origin ?? ""))
    throw new ApplicationError("FORBIDDEN", "Invalid request origin");
  const id = randomUUID(),
    at = Date.now();
  const connection = await getDatabaseConnection();
  await connection.transaction(
    (session) =>
      appendAudit(
        connection,
        session,
        {
          actor: { kind: "admin", id: actor.id },
          area: "print",
          action: "print.browser_test_requested",
          subject: { kind: "print-test", id },
          requestId,
          idempotencyKey: `print-test:${id}`,
          metadata: { mode: "browser", bridgeDelivery: false },
        },
        new Date(at),
      ),
    { writeConcern: { w: "majority" } },
  );
  return {
    url: `/api/admin/settings/printing/test?id=${id}&at=${at}&sig=${printSignature(id, at, actor.id)}`,
  };
}

export async function browserTestPrintHtml(actor: SettingsActor, parameters: URLSearchParams) {
  const id = parameters.get("id") ?? "",
    atValue = parameters.get("at") ?? "",
    signature = parameters.get("sig") ?? "";
  const at = Number(atValue);
  if (
    parameters.size !== 3 ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !/^\d{13}$/.test(atValue) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !Number.isSafeInteger(at) ||
    Date.now() - at > 120_000 ||
    at > Date.now() + 5000
  )
    throw new ApplicationError("FORBIDDEN", "Invalid or expired print test link");
  if (
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(printSignature(id, at, actor.id), "hex"),
    )
  )
    throw new ApplicationError("FORBIDDEN", "Invalid print test link");
  const service = await createSettingsService();
  const [business, printing] = await Promise.all([
    service.read(actor, "business"),
    service.read(actor, "printing"),
  ]);
  return renderBrowserTestPrint(
    business.values as SettingsValues["business"],
    printing.values as SettingsValues["printing"],
    new Date(at),
  );
}
