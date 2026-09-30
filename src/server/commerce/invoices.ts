import "server-only";

import type { Connection } from "mongoose";

import { appendAudit } from "../../modules/audit/server.ts";
import { createAdminSecurity, createCustomerSecurity } from "../../modules/auth/server.ts";
import { type InvoicePorts, MongoInvoiceRepository } from "../../modules/invoices/server.ts";
import { appendOutbox } from "../../modules/notifications/server.ts";
import { invoiceIdentitySettings } from "../../modules/settings/server.ts";
import { getDatabaseConnection } from "../database/connection.ts";
import { getServerConfig } from "../secrets/config.ts";

export function composeInvoiceRepository(
  connection: Connection,
  keys: { customerSessionSecret: string; adminSessionSecret: string },
  now: () => Date = () => new Date(),
) {
  const admin = createAdminSecurity(connection, keys.adminSessionSecret, now);
  const customer = createCustomerSecurity(connection, keys.customerSessionSecret, now);
  const ports: InvoicePorts = {
    settings: (session) => invoiceIdentitySettings(connection, session),
    admin: (token, capability, session) => admin.store.authorize(token, capability, session),
    customer: (token, session) => customer.store.authorize(token, session),
    record: async (session, actor, event, invoiceId, orderId, requestId, reprint) => {
      const idempotencyKey = reprint
        ? `invoice:reprint:${reprint.id}`
        : `invoice:issued:${invoiceId}`;
      await appendAudit(
        connection,
        session,
        {
          actor,
          area: "invoice",
          action: event,
          subject: { kind: "invoice", id: invoiceId },
          requestId,
          idempotencyKey,
          metadata: reprint ? { paperWidthMm: reprint.paperWidthMm } : {},
        },
        now(),
      );
      await appendOutbox(
        connection,
        session,
        [
          {
            actor,
            aggregateKind: "invoice",
            aggregateId: invoiceId,
            eventType: event,
            requestId,
            idempotencyKey,
            payload: {
              invoiceId,
              orderId,
              ...(reprint ? { reprintId: reprint.id, paperWidthMm: reprint.paperWidthMm } : {}),
            },
          },
        ],
        now(),
      );
    },
  };
  return new MongoInvoiceRepository(connection, ports, now);
}

export async function configuredInvoiceRepository() {
  const config = getServerConfig();
  return composeInvoiceRepository(await getDatabaseConnection(), {
    customerSessionSecret: config.auth.sessionSecret,
    adminSessionSecret: config.auth.adminSessionSecret,
  });
}
