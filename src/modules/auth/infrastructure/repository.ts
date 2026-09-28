import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { type ClientSession, type Connection, Types } from "mongoose";

import {
  type AdminCapability,
  requireAdminCapability,
} from "../../../shared/admin-capabilities.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { SecurityCommit, TransactionContext } from "../../../shared/security-ports.ts";
import type {
  AdminAuthStore,
  AdminCredentialIdentity,
  IssuedAdminSession,
} from "../application/admin-auth.ts";
import {
  ADMIN_SESSION_IDLE_MS,
  ADMIN_SESSION_TTL_MS,
  type AdminPrincipal,
  validAdminToken,
} from "../domain/admin-session.ts";

type Row = {
  _id: Types.ObjectId;
  principalKind: "admin" | "customer";
  principalId: Types.ObjectId;
  tokenHash: string;
  authVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
type IdentityStore = {
  byUsername(username: string): Promise<AdminCredentialIdentity | null>;
  byId(id: string, tx?: TransactionContext): Promise<AdminCredentialIdentity | null>;
  lock(
    id: string,
    authVersion: number,
    tx: TransactionContext,
    hash?: string,
  ): Promise<AdminCredentialIdentity | null>;
  trackLogin(id: string, tx: TransactionContext): Promise<void>;
};
const session = (tx?: TransactionContext) => tx as ClientSession | undefined;
export class MongoAdminAuthStore implements AdminAuthStore {
  private readonly connection: Connection;
  private readonly identities: IdentityStore;
  private readonly key: string;
  private readonly commit: SecurityCommit;
  private readonly failureAudit: (requestId: string) => Promise<void>;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    identities: IdentityStore,
    key: string,
    commit: SecurityCommit,
    failureAudit: (requestId: string) => Promise<void>,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.identities = identities;
    this.key = key;
    this.commit = commit;
    this.failureAudit = failureAudit;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("sessions");
  }
  private digest(purpose: string, value: string) {
    return createHmac("sha256", this.key)
      .update(`armani-admin-${purpose}-v1\0`)
      .update(value)
      .digest("hex");
  }
  async throttle(username: string, network: string) {
    const windowMs = 15 * 60 * 1000,
      bucket = Math.floor(this.now().getTime() / windowMs),
      expiresAt = new Date((bucket + 1) * windowMs);
    const collection = this.connection.db!.collection<{
      _id: string;
      count: number;
      expiresAt: Date;
    }>("admin_login_throttles");
    for (const [scope, value, limit] of [
      ["network", network, 300],
      ["account", username, 5],
    ] as const) {
      if (typeof value !== "string" || value.length > 256)
        throw new ApplicationError("VALIDATION", "Invalid trusted throttle context");
      const id = this.digest("throttle", `${scope}:${value}:${bucket}`);
      let row;
      try {
        row = await collection.findOneAndUpdate(
          { _id: id },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, returnDocument: "after" },
        );
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000)
          row = await collection.findOneAndUpdate(
            { _id: id },
            { $inc: { count: 1 } },
            { returnDocument: "after" },
          );
        else throw new ApplicationError("UNAVAILABLE", "Login throttling unavailable");
      }
      if (!row) throw new ApplicationError("UNAVAILABLE", "Login throttling unavailable");
      if (row.count > limit) throw new ApplicationError("RATE_LIMITED", "Login attempts limited");
    }
  }
  credentials(username: string) {
    return this.identities.byUsername(username);
  }
  rejectLogin(requestId: string) {
    return this.failureAudit(requestId);
  }
  private async active(token: string | null, tx?: TransactionContext) {
    if (!validAdminToken(token)) return null;
    const now = this.now();
    return this.rows().findOne(
      {
        tokenHash: this.digest("session", token),
        principalKind: "admin",
        revokedAt: null,
        expiresAt: { $gt: now },
        lastUsedAt: { $gt: new Date(now.getTime() - ADMIN_SESSION_IDLE_MS) },
      },
      { session: session(tx) },
    );
  }
  private principal(row: Row, identity: AdminCredentialIdentity): AdminPrincipal {
    return {
      id: identity.id,
      role: identity.role,
      username: identity.username,
      displayName: identity.displayName,
      sessionId: row._id.toString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  async resolve(token: string | null): Promise<AdminPrincipal | null> {
    const row = await this.active(token);
    if (!row) return null;
    const identity = await this.identities.byId(row.principalId.toString());
    if (
      !identity ||
      identity.status !== "active" ||
      identity.deletedAt ||
      identity.authVersion !== row.authVersion
    )
      return null;
    const touched = await this.rows().updateOne(
      { _id: row._id, revokedAt: null, expiresAt: { $gt: this.now() } },
      { $set: { lastUsedAt: this.now(), updatedAt: this.now() } },
    );
    return touched.matchedCount === 1 ? this.principal(row, identity) : null;
  }
  async authorize(token: string | null, capability: AdminCapability, tx?: TransactionContext) {
    if (!tx) return requireAdminCapability(await this.resolve(token), capability);
    const row = await this.active(token, tx);
    if (!row) throw new ApplicationError("UNAUTHORIZED", "Valid admin session required");
    const identity = await this.identities.lock(row.principalId.toString(), row.authVersion, tx);
    if (!identity) throw new ApplicationError("UNAUTHORIZED", "Active admin required");
    return requireAdminCapability(this.principal(row, identity), capability);
  }
  private async issue(
    identity: AdminCredentialIdentity,
    expiresAt: Date,
    tx: TransactionContext,
  ): Promise<IssuedAdminSession> {
    const token = randomBytes(32).toString("base64url"),
      timestamp = this.now();
    const row: Row = {
      _id: new Types.ObjectId(),
      principalKind: "admin",
      principalId: new Types.ObjectId(identity.id),
      tokenHash: this.digest("session", token),
      authVersion: identity.authVersion,
      expiresAt,
      revokedAt: null,
      lastUsedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      __v: 0,
    };
    await this.rows().insertOne(row, { session: session(tx) });
    return { token, expiresAt, principal: this.principal(row, identity) };
  }
  private async revokeToken(token: string | null, tx: TransactionContext) {
    if (validAdminToken(token))
      await this.rows().updateOne(
        { tokenHash: this.digest("session", token), principalKind: "admin", revokedAt: null },
        { $set: { revokedAt: this.now(), updatedAt: this.now() } },
        { session: session(tx) },
      );
  }
  async revokeAll(tx: TransactionContext, id: string) {
    await this.rows().updateMany(
      { principalKind: "admin", principalId: new Types.ObjectId(id), revokedAt: null },
      { $set: { revokedAt: this.now(), updatedAt: this.now() } },
      { session: session(tx) },
    );
  }
  async login(identity: AdminCredentialIdentity, previousToken: string | null, requestId: string) {
    return this.commit(
      {
        actor: { kind: "admin", id: identity.id },
        action: "admin.login",
        subjectId: identity.id,
        requestId,
      },
      async (tx) => {
        const current = await this.identities.lock(
          identity.id,
          identity.authVersion,
          tx,
          identity.passwordHash,
        );
        if (!current) throw new ApplicationError("INVALID_CREDENTIALS", "Invalid credentials");
        await this.revokeToken(previousToken, tx);
        await this.identities.trackLogin(identity.id, tx);
        return this.issue(current, new Date(this.now().getTime() + ADMIN_SESSION_TTL_MS), tx);
      },
    );
  }
  async rotate(token: string | null, requestId: string) {
    const actor = await this.authorize(token, "admin.access");
    return this.commit(
      {
        actor: { kind: "admin", id: actor.id },
        action: "admin.session_rotated",
        subjectId: actor.id,
        requestId,
      },
      async (tx) => {
        const row = await this.active(token, tx);
        if (!row) throw new ApplicationError("UNAUTHORIZED", "Valid session required");
        const identity = await this.identities.lock(
          row.principalId.toString(),
          row.authVersion,
          tx,
        );
        if (!identity) throw new ApplicationError("UNAUTHORIZED", "Active admin required");
        await this.revokeToken(token, tx);
        return this.issue(identity, row.expiresAt, tx);
      },
    );
  }
  async logout(token: string | null, requestId: string): Promise<void> {
    const actor = await this.resolve(token);
    if (!actor) return;
    await this.commit(
      {
        actor: { kind: "admin", id: actor.id },
        action: "admin.logout",
        subjectId: actor.id,
        requestId,
      },
      (tx) => this.revokeToken(token, tx),
    );
  }
}
