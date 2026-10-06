import "server-only";

import { randomUUID } from "node:crypto";

import type { Connection } from "mongoose";

import { getDatabaseConnection } from "../../server/database/connection.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import { requireAdminCapability } from "../../shared/admin-capabilities.ts";
import { ApplicationError } from "../../shared/errors.ts";
import type { SecurityCommit } from "../../shared/security-ports.ts";
import { AdminService, createAdminsHttpHandler, MongoAdminRepository } from "../admins/server.ts";
import { appendAudit } from "../audit/server.ts";
import { MongoCustomerRepository } from "../customers/server.ts";
import { commitSensitiveChange } from "../notifications/server.ts";
import { AdminAuthService } from "./application/admin-auth.ts";
import { CustomerAuthService, type CustomerProofVerifier } from "./application/customer-auth.ts";
import { validAdminToken } from "./domain/admin-session.ts";
import { createCustomerHttpHandler } from "./infrastructure/customer-http.ts";
import { MongoCustomerAuthStore } from "./infrastructure/customer-repository.ts";
import { createAdminAuthHttpHandler, readAdminCookie } from "./infrastructure/http.ts";
import { ScryptPasswords } from "./infrastructure/passwords.ts";
import { MongoAdminAuthStore } from "./infrastructure/repository.ts";

export {
  createCustomerHttpHandler,
  customerCookie,
  readCustomerCookie,
} from "./infrastructure/customer-http.ts";
export { adminCookie, createAdminAuthHttpHandler, readAdminCookie } from "./infrastructure/http.ts";
export { isSupportedAdminPasswordHash, ScryptPasswords } from "./infrastructure/passwords.ts";
export {
  adminLoginThrottleSchema,
  customerAuthThrottleSchema,
  sessionSchema,
} from "./infrastructure/schema.ts";
export async function requireAdminPage(
  capability: import("../../shared/admin-capabilities.ts").AdminCapability = "admin.access",
) {
  // Keep the Next-only page adapter out of Node CLI import graphs.
  const { requireAdminPage: guardAdminPage } = await import("./infrastructure/guards.ts");
  return guardAdminPage(capability, async (token) =>
    (await configuredAdminSecurity()).auth.resolve(token),
  );
}

/** Production composition; injectable clock/key only for isolated backend tests. */
export function createAdminSecurity(
  connection: Connection,
  key: string,
  now: () => Date = () => new Date(),
) {
  const commit: SecurityCommit = async (change, operation) => {
    const idempotencyKey = `admin:${randomUUID()}`;
    try {
      return await commitSensitiveChange(
        connection,
        {
          audit: {
            actor: change.actor,
            area: "admin",
            action: change.action,
            subject: { kind: "admin", id: change.subjectId },
            requestId: change.requestId,
            idempotencyKey,
            metadata: change.metadata ?? {},
          },
          events: [
            {
              actor: change.actor,
              aggregateKind: "admin",
              aggregateId: change.subjectId,
              eventType: change.action,
              payload: { adminId: change.subjectId },
              requestId: change.requestId,
              idempotencyKey,
            },
          ],
          change: (tx) => operation(tx),
        },
        now,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError(
          "CONFLICT",
          "Admin security change conflicts with existing data",
        );
      throw new ApplicationError("UNAVAILABLE", "Admin security transaction failed");
    }
  };
  const passwords = new ScryptPasswords();
  const holder: { store?: MongoAdminAuthStore } = {};
  const activeStore = () => {
    if (!holder.store) throw new ApplicationError("UNAVAILABLE", "Admin security is not ready");
    return holder.store;
  };
  const repository = new MongoAdminRepository(
    connection,
    (token, capability, tx) => activeStore().authorize(token, capability, tx),
    (tx, id) => activeStore().revokeAll(tx, id),
    commit,
    now,
  );
  const store = new MongoAdminAuthStore(
    connection,
    {
      byUsername: (username) => repository.identityByUsername(username),
      byId: (id, tx) => repository.identityById(id, tx),
      lock: (id, version, tx, hash) => repository.lockIdentity(id, version, tx, hash),
      trackLogin: (id, tx) => repository.trackLogin(id, tx),
    },
    key,
    commit,
    async (requestId) => {
      try {
        await connection.transaction((tx) =>
          appendAudit(
            connection,
            tx,
            {
              actor: { kind: "system", id: null },
              area: "admin",
              action: "admin.login_rejected",
              subject: { kind: "admin-auth", id: "anonymous" },
              requestId,
              idempotencyKey: `admin-failure:${randomUUID()}`,
              outcome: "failure",
              metadata: {},
            },
            now(),
          ),
        );
      } catch {
        throw new ApplicationError("UNAVAILABLE", "Authentication audit unavailable");
      }
    },
    now,
  );
  holder.store = store;
  return {
    auth: new AdminAuthService(store, passwords),
    admins: new AdminService(repository, passwords, (token, capability, tx) =>
      store.authorize(token, capability, tx),
    ),
    repository,
    passwords,
    store,
  };
}
export async function configuredAdminSecurity() {
  const config = getServerConfig();
  return createAdminSecurity(await getDatabaseConnection(), config.auth.adminSessionSecret);
}
export function adminTokenFromRequest(request: Request) {
  return readAdminCookie(request, getServerConfig().mode === "production");
}
export async function authenticateAdminRequest(request: Request) {
  const token = adminTokenFromRequest(request);
  if (!validAdminToken(token)) return null;
  return (await configuredAdminSecurity()).auth.resolve(token);
}
const origins = () => {
  const config = getServerConfig();
  return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
};
export const handleAdminAuthHttp = createAdminAuthHttpHandler({
  service: async () => (await configuredAdminSecurity()).auth,
  production: () => getServerConfig().mode === "production",
  origins,
  network: () => "shared-untrusted-network",
});
export const handleAdminsHttp = createAdminsHttpHandler({
  service: async () => (await configuredAdminSecurity()).admins,
  authenticate: authenticateAdminRequest,
  token: adminTokenFromRequest,
  origins,
});
export async function requireAdminToken(
  token: string | null,
  capability: import("../../shared/admin-capabilities.ts").AdminCapability,
) {
  return requireAdminCapability(
    await (await configuredAdminSecurity()).auth.resolve(token),
    capability,
  );
}

/** Separate customer secret and token namespace; shares only the session collection. */
export function createCustomerSecurity(
  connection: Connection,
  key: string,
  now: () => Date = () => new Date(),
  proofs: CustomerProofVerifier = {
    verify: async () => {
      throw new ApplicationError("UNAVAILABLE", "SMS verification is not configured");
    },
  },
) {
  const commit: SecurityCommit = async (change, operation) => {
    const idempotencyKey = `customer:${randomUUID()}`;
    try {
      return await commitSensitiveChange(
        connection,
        {
          audit: {
            actor: change.actor,
            area: "customer",
            action: change.action,
            subject: { kind: "customer", id: change.subjectId },
            requestId: change.requestId,
            idempotencyKey,
            metadata: change.metadata ?? {},
          },
          events: [
            {
              actor: change.actor,
              aggregateKind: "customer",
              aggregateId: change.subjectId,
              eventType: change.action,
              payload: { customerId: change.subjectId },
              requestId: change.requestId,
              idempotencyKey,
            },
          ],
          change: (tx) => operation(tx),
        },
        now,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError("CONFLICT", "Customer identity already exists");
      throw new ApplicationError("UNAVAILABLE", "Customer security transaction failed");
    }
  };
  const customers = new MongoCustomerRepository(connection, now);
  const store = new MongoCustomerAuthStore(
    connection,
    customers,
    key,
    commit,
    async (requestId) => {
      try {
        await connection.transaction((tx) =>
          appendAudit(
            connection,
            tx,
            {
              actor: { kind: "system", id: null },
              area: "customer",
              action: "customer.login_rejected",
              subject: { kind: "customer-auth", id: "anonymous" },
              requestId,
              idempotencyKey: `customer-failure:${randomUUID()}`,
              outcome: "failure",
              metadata: {},
            },
            now(),
          ),
        );
      } catch {
        throw new ApplicationError("UNAVAILABLE", "Customer authentication audit unavailable");
      }
    },
    now,
  );
  return {
    auth: new CustomerAuthService(store, proofs),
    customers,
    store,
  };
}
export async function configuredCustomerSecurity() {
  const config = getServerConfig();
  return createCustomerSecurity(await getDatabaseConnection(), config.auth.sessionSecret);
}
export const handleCustomerHttp = createCustomerHttpHandler({
  service: async () => (await configuredCustomerSecurity()).auth,
  production: () => getServerConfig().mode === "production",
  origins,
});
