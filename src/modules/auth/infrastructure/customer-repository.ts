import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { SecurityCommit, TransactionContext } from "../../../shared/security-ports.ts";
import type {
  CustomerAuthStore,
  CustomerCredentialIdentity,
  CustomerIdentityRepository,
  CustomerProfileUpdate,
  CustomerSignup,
  IssuedCustomerSession,
} from "../application/customer-auth.ts";
import {
  CUSTOMER_SESSION_IDLE_MS,
  CUSTOMER_SESSION_TTL_MS,
  type CustomerPrincipal,
  validCustomerToken,
} from "../domain/customer-session.ts";

type Row = {
  _id: Types.ObjectId;
  principalKind: "customer";
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
const mongoSession = (tx?: TransactionContext) => tx as ClientSession | undefined;
export class MongoCustomerAuthStore implements CustomerAuthStore {
  private readonly connection: Connection;
  private readonly customers: CustomerIdentityRepository;
  private readonly key: string;
  private readonly commit: SecurityCommit;
  private readonly failureAudit: (requestId: string) => Promise<void>;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    customers: CustomerIdentityRepository,
    key: string,
    commit: SecurityCommit,
    failureAudit: (requestId: string) => Promise<void>,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.customers = customers;
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
      .update(`armani-customer-${purpose}-v1\0`)
      .update(value)
      .digest("hex");
  }
  async throttle(phone: string, operation: "signup" | "login") {
    const windowMs = 15 * 60 * 1000;
    const bucket = Math.floor(this.now().getTime() / windowMs);
    const expiresAt = new Date((bucket + 1) * windowMs);
    const collection = this.connection.db!.collection<{
      _id: string;
      count: number;
      expiresAt: Date;
    }>("customer_auth_throttles");
    for (const [scope, value, limit] of [
      ["global", "shared-untrusted-network", 300],
      [operation, phone, 5],
    ] as const) {
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
        else throw new ApplicationError("UNAVAILABLE", "Customer throttling unavailable");
      }
      if (!row) throw new ApplicationError("UNAVAILABLE", "Customer throttling unavailable");
      if (row.count > limit)
        throw new ApplicationError("RATE_LIMITED", "Customer attempts limited");
    }
  }
  credentials(phone: string) {
    return this.customers.byPhone(phone);
  }
  rejectLogin(requestId: string) {
    return this.failureAudit(requestId);
  }
  async signup(input: Omit<CustomerSignup, "proof">, requestId: string) {
    const id = new Types.ObjectId().toString();
    return this.commit(
      {
        actor: { kind: "system", id: null },
        action: "customer.signed_up",
        subjectId: id,
        requestId,
      },
      (tx) => this.customers.create(id, input, tx),
    );
  }
  private async active(token: string | null, tx?: TransactionContext) {
    if (!validCustomerToken(token)) return null;
    const now = this.now();
    return this.rows().findOne(
      {
        tokenHash: this.digest("session", token),
        principalKind: "customer",
        revokedAt: null,
        expiresAt: { $gt: now },
        lastUsedAt: { $gt: new Date(now.getTime() - CUSTOMER_SESSION_IDLE_MS) },
      },
      { session: mongoSession(tx) },
    );
  }
  private principal(row: Row, identity: CustomerCredentialIdentity): CustomerPrincipal {
    return {
      id: identity.id,
      phone: identity.phone,
      sessionId: row._id.toString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  async resolve(token: string | null): Promise<CustomerPrincipal | null> {
    const row = await this.active(token);
    if (!row) return null;
    const identity = await this.customers.byId(row.principalId.toString());
    if (!identity || identity.status !== "active" || identity.authVersion !== row.authVersion)
      return null;
    const touched = await this.rows().updateOne(
      { _id: row._id, revokedAt: null, expiresAt: { $gt: this.now() } },
      { $set: { lastUsedAt: this.now(), updatedAt: this.now() } },
    );
    return touched.matchedCount === 1 ? this.principal(row, identity) : null;
  }
  /** Session write serializes privileged customer work with logout/rotation. */
  async authorize(token: string | null, tx: TransactionContext): Promise<{ id: string }> {
    const row = await this.active(token, tx);
    if (!row) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
    const identity = await this.customers.byId(String(row.principalId), tx);
    if (!identity || identity.status !== "active" || identity.authVersion !== row.authVersion)
      throw new ApplicationError("UNAUTHORIZED", "Customer session required");
    const touched = await this.rows().updateOne(
      {
        _id: row._id,
        principalKind: "customer",
        revokedAt: null,
        authVersion: row.authVersion,
        expiresAt: { $gt: this.now() },
      },
      { $set: { lastUsedAt: this.now(), updatedAt: this.now() }, $inc: { __v: 1 } },
      { session: mongoSession(tx) },
    );
    if (touched.matchedCount !== 1)
      throw new ApplicationError("UNAUTHORIZED", "Customer session required");
    return { id: identity.id };
  }
  private async issue(
    identity: CustomerCredentialIdentity,
    expiresAt: Date,
    tx: TransactionContext,
  ): Promise<IssuedCustomerSession> {
    const token = randomBytes(32).toString("base64url");
    const timestamp = this.now();
    const row: Row = {
      _id: new Types.ObjectId(),
      principalKind: "customer",
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
    await this.rows().insertOne(row, { session: mongoSession(tx) });
    return { token, expiresAt, principal: this.principal(row, identity) };
  }
  private async revoke(token: string | null, tx: TransactionContext) {
    if (validCustomerToken(token))
      await this.rows().updateOne(
        { tokenHash: this.digest("session", token), principalKind: "customer", revokedAt: null },
        { $set: { revokedAt: this.now(), updatedAt: this.now() } },
        { session: mongoSession(tx) },
      );
  }
  async login(
    identity: CustomerCredentialIdentity,
    previousToken: string | null,
    requestId: string,
  ) {
    return this.commit(
      {
        actor: { kind: "customer", id: identity.id },
        action: "customer.login",
        subjectId: identity.id,
        requestId,
      },
      async (tx) => {
        const current = await this.customers.byId(identity.id, tx);
        if (
          !current ||
          current.status !== "active" ||
          current.authVersion !== identity.authVersion
        )
          throw new ApplicationError("INVALID_CREDENTIALS", "Invalid credentials");
        await this.revoke(previousToken, tx);
        return this.issue(current, new Date(this.now().getTime() + CUSTOMER_SESSION_TTL_MS), tx);
      },
    );
  }
  async rotate(token: string | null, requestId: string) {
    const principal = await this.resolve(token);
    if (!principal) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
    return this.commit(
      {
        actor: { kind: "customer", id: principal.id },
        action: "customer.session_rotated",
        subjectId: principal.id,
        requestId,
      },
      async (tx) => {
        const row = await this.active(token, tx);
        if (!row) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
        const identity = await this.customers.byId(row.principalId.toString(), tx);
        if (!identity || identity.status !== "active" || identity.authVersion !== row.authVersion)
          throw new ApplicationError("UNAUTHORIZED", "Customer session required");
        await this.revoke(token, tx);
        return this.issue(identity, row.expiresAt, tx);
      },
    );
  }
  async logout(token: string | null, requestId: string) {
    const principal = await this.resolve(token);
    if (!principal) return;
    await this.commit(
      {
        actor: { kind: "customer", id: principal.id },
        action: "customer.logout",
        subjectId: principal.id,
        requestId,
      },
      (tx) => this.revoke(token, tx),
    );
  }
  async profile(token: string | null) {
    const principal = await this.resolve(token);
    if (!principal) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
    return this.customers.profile(principal.id);
  }
  async update(token: string | null, input: CustomerProfileUpdate, requestId: string) {
    const principal = await this.resolve(token);
    if (!principal) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
    return this.commit(
      {
        actor: { kind: "customer", id: principal.id },
        action: "customer.profile_updated",
        subjectId: principal.id,
        requestId,
      },
      async (tx) => {
        const row = await this.active(token, tx);
        if (!row || row.principalId.toString() !== principal.id)
          throw new ApplicationError("UNAUTHORIZED", "Customer session required");
        const identity = await this.customers.byId(principal.id, tx);
        if (!identity || identity.status !== "active" || identity.authVersion !== row.authVersion)
          throw new ApplicationError("UNAUTHORIZED", "Customer session required");
        return this.customers.update(principal.id, input, tx);
      },
    );
  }
}
