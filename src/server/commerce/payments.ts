import "server-only";

import type { Connection } from "mongoose";

import { appendAudit } from "../../modules/audit/server.ts";
import { appendOutbox } from "../../modules/notifications/server.ts";
import { selectProvider } from "../../modules/payments/index.ts";
import {
  createPaymentCallbackHandler,
  createPaymentService,
  FakePaymentProvider,
  IranianGatewayPlaceholder,
  MongoFakeLedger,
  type PaymentPorts,
  type ProviderFactory,
  ProviderRegistry,
} from "../../modules/payments/server.ts";
import { parseProviderCredentials, type SettingsValues } from "../../modules/settings/index.ts";
import { createSettingsRepository, SettingsVault } from "../../modules/settings/server.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { getDatabaseConnection } from "../database/connection.ts";
import { getServerConfig } from "../secrets/config.ts";
import { composeOrderService } from "./orders.ts";
// Add documented gateway factories here once. Settings select among registered adapters.
const gatewayFactories = new Map<string, ProviderFactory>();

export function composePaymentFramework(
  connection: Connection,
  options: {
    intent: PaymentPorts["intent"];
    settled?: PaymentPorts["settled"];
    vault: SettingsVault;
    callbackBaseUrl: string;
    production?: boolean;
    adapters?: ReadonlyMap<string, ProviderFactory>;
    now?: () => Date;
    timeoutMs?: number;
  },
) {
  const now = options.now ?? (() => new Date()),
    vault = options.vault;
  const base = new URL(options.callbackBaseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (options.production && base.protocol !== "https:") ||
    !["http:", "https:"].includes(base.protocol)
  )
    throw new ApplicationError("VALIDATION", "Payment callback must be a trusted origin");
  const ledger = new MongoFakeLedger(connection),
    settings = createSettingsRepository(connection, vault, now);
  const factories = new Map<string, ProviderFactory>(options.adapters ?? []);
  factories.set("fake", () => {
    if (options.production)
      throw new ApplicationError("UNAVAILABLE", "Fake provider forbidden in production");
    return new FakePaymentProvider(ledger, base.origin);
  });
  factories.set("iranian-gateway", () => new IranianGatewayPlaceholder());
  const registry = new ProviderRegistry(factories);
  return createPaymentService(
    connection,
    {
      intent: options.intent,
      settled: options.settled,
      configuration: () =>
        settings.withCredentials("payment", async (raw, secrets) => {
          const values = raw as SettingsValues["payment"];
          const credentials = secrets.providerCredentials
            ? parseProviderCredentials(secrets.providerCredentials)
            : {};
          const choice = selectProvider(
            [
              {
                id: "fake",
                enabled: values.fakeEnabled,
                priority: values.fakePriority,
                mode: "sandbox",
              },
              ...(values.providers ?? []).map((p) => ({ ...p, credential: credentials[p.id] })),
            ],
            values.defaultProvider,
            !!options.production,
          );
          const configuration = {
            id: choice.id,
            mode: choice.mode,
            ...(choice.credential ? { credential: choice.credential } : {}),
          };
          if (choice.id !== "fake" && !configuration.credential)
            throw new ApplicationError(
              "UNAVAILABLE",
              "Payment provider credentials are not configured",
            );
          registry.get(configuration);
          return configuration;
        }),
      seal: (configuration) =>
        configuration.credential
          ? vault.seal("payment", { gatewayCredential: configuration.credential })
          : null,
      open: (id, mode, payload) => ({
        id,
        mode,
        ...(payload ? { credential: vault.open("payment", payload).gatewayCredential } : {}),
      }),
      callbackKeyId: vault.keyId,
      callbackToken: (id, keyId) => vault.fingerprint(`payment-callback:${id}`, keyId),
      callbackBaseUrl: base.origin,
      record: async (session, view, event, requestId) => {
        const actor = { kind: "system" as const, id: null },
          idempotencyKey = `payment:${view.id}:${view.revision}:${event}`;
        await appendAudit(
          connection,
          session,
          {
            actor,
            area: "payment",
            action: event,
            subject: { kind: "transaction", id: view.id },
            requestId,
            idempotencyKey,
            metadata: { provider: view.provider, status: view.status, issue: view.issue },
          },
          now(),
        );
        await appendOutbox(
          connection,
          session,
          [
            {
              actor,
              aggregateKind: "payment",
              aggregateId: view.id,
              eventType: event,
              requestId,
              idempotencyKey,
              payload: {
                transactionId: view.id,
                orderId: view.orderId,
                amountToman: view.amountToman,
                status: view.status,
              },
            },
          ],
          now(),
        );
      },
    },
    registry,
    now,
    options.timeoutMs,
  );
}
export async function configuredPaymentFramework() {
  const config = getServerConfig();
  const connection = await getDatabaseConnection();
  const orders = composeOrderService(connection, {
    customerSessionSecret: config.auth.sessionSecret,
    adminSessionSecret: config.auth.adminSessionSecret,
  }).repository;
  return composePaymentFramework(connection, {
    intent: (id, session) => orders.paymentIntent(id, session),
    settled: async (session, view, requestId) => {
      await orders.confirmInside(session, view.id, requestId);
    },
    vault: new SettingsVault(config.encryption.key, config.encryption.previousKey),
    callbackBaseUrl: config.paymentCallbackBaseUrl,
    production: config.mode === "production",
    adapters: gatewayFactories,
  });
}
export const handlePaymentCallback = createPaymentCallbackHandler({
  service: configuredPaymentFramework,
  providerIds: () => ["fake", ...gatewayFactories.keys()],
  callbackOrigin: () => new URL(getServerConfig().paymentCallbackBaseUrl).origin,
});
