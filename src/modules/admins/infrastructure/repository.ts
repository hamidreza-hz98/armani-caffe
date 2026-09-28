import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { asUtcTimestamp } from "../../../shared/domain.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type {
  AdminAuthorizer,
  SecurityCommit,
  TransactionContext,
} from "../../../shared/security-ports.ts";
import type { AdminRepository } from "../application/service.ts";
import { type AdminCreate, type AdminUpdate, parseAdminCreate } from "../contracts/admin.ts";
import type { AdminDetails } from "../domain/model.ts";

type Row = {
  _id: Types.ObjectId;
  username: string;
  phone: string;
  displayName: string;
  passwordHash: string;
  role: "OWNER" | "CASHIER";
  status: "active" | "disabled";
  authVersion: number;
  authorizationGuard: number;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
const session = (tx?: TransactionContext) => tx as ClientSession | undefined;
function dto(row: Row): AdminDetails {
  return {
    id: row._id.toString(),
    username: row.username,
    phone: row.phone,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    revision: row.__v,
    createdAt: asUtcTimestamp(row.createdAt.toISOString()),
    updatedAt: asUtcTimestamp(row.updatedAt.toISOString()),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
function identity(row: Row | null) {
  if (
    !row ||
    !Number.isSafeInteger(row.authVersion) ||
    row.authVersion < 1 ||
    !["OWNER", "CASHIER"].includes(row.role) ||
    !["active", "disabled"].includes(row.status)
  )
    return null;
  return {
    id: row._id.toString(),
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    authVersion: row.authVersion,
    deletedAt: row.deletedAt,
    passwordHash: row.passwordHash,
  };
}
export class MongoAdminRepository implements AdminRepository {
  private readonly connection: Connection;
  private readonly authorize: AdminAuthorizer;
  private readonly revoke: (tx: TransactionContext, id: string) => Promise<void>;
  private readonly commit: SecurityCommit;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    authorize: AdminAuthorizer,
    revoke: (tx: TransactionContext, id: string) => Promise<void>,
    commit: SecurityCommit,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.authorize = authorize;
    this.revoke = revoke;
    this.commit = commit;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("admins");
  }
  private guards() {
    return this.connection.db!.collection<{ _id: string; revision: number }>("admin_owner_guard");
  }
  async identityByUsername(username: string) {
    return identity(await this.rows().findOne({ username }));
  }
  async identityById(id: string, tx?: TransactionContext) {
    return identity(
      await this.rows().findOne({ _id: new Types.ObjectId(id) }, { session: session(tx) }),
    );
  }
  async lockIdentity(
    id: string,
    authVersion: number,
    tx: TransactionContext,
    expectedHash?: string,
  ) {
    return identity(
      await this.rows().findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          authVersion,
          status: "active",
          deletedAt: null,
          ...(expectedHash ? { passwordHash: expectedHash } : {}),
        },
        { $inc: { authorizationGuard: 1 } },
        { session: session(tx), returnDocument: "after" },
      ),
    );
  }
  async trackLogin(id: string, tx: TransactionContext) {
    await this.rows().updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { lastLoginAt: this.now(), updatedAt: this.now() } },
      { session: session(tx) },
    );
  }
  private async lockOwners(tx: TransactionContext) {
    const result = await this.guards().updateOne(
      { _id: "active-owners" },
      { $inc: { revision: 1 } },
      { session: session(tx) },
    );
    if (result.matchedCount !== 1)
      throw new ApplicationError(
        "UNAVAILABLE",
        "Apply explicit admin security migration before writes",
      );
  }
  private async protectOwner(
    prior: Row,
    nextRole: Row["role"],
    nextStatus: Row["status"],
    deleting: boolean,
    tx: TransactionContext,
  ) {
    if (
      prior.role === "OWNER" &&
      prior.status === "active" &&
      !prior.deletedAt &&
      (deleting || nextRole !== "OWNER" || nextStatus !== "active") &&
      (await this.rows().countDocuments(
        { role: "OWNER", status: "active", deletedAt: null },
        { session: session(tx) },
      )) <= 1
    )
      throw new ApplicationError("CONFLICT", "The final active owner must remain active");
  }
  private async mutation<T>(
    token: string | null,
    action: string,
    subjectId: string,
    requestId: string,
    operation: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    const actor = await this.authorize(token, "admins.manage");
    try {
      return await this.commit(
        { actor: { kind: "admin", id: actor.id }, action, subjectId, requestId },
        async (tx) => {
          await this.lockOwners(tx);
          await this.authorize(token, "admins.manage", tx);
          return operation(tx);
        },
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError("CONFLICT", "Admin identity already exists");
      throw new ApplicationError("UNAVAILABLE", "Admin transaction failed");
    }
  }
  async bootstrap(input: unknown, hash: string, requestId: string): Promise<AdminDetails> {
    const values = parseAdminCreate(input);
    if (values.role !== "OWNER")
      throw new ApplicationError("VALIDATION", "Bootstrap requires OWNER");
    const indexes = await this.rows().listIndexes().toArray();
    if (
      !["admin_username_unique", "admin_phone_unique"].every((name) =>
        indexes.some((index) => index.name === name && index.unique === true),
      )
    )
      throw new ApplicationError("UNAVAILABLE", "Apply admin uniqueness indexes before bootstrap");
    // Explicit command only; this does not run in requests or generic seeds.
    await this.guards().updateOne(
      { _id: "active-owners" },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
    const id = new Types.ObjectId();
    try {
      return await this.commit(
        {
          actor: { kind: "system", id: null },
          action: "admin.bootstrapped",
          subjectId: id.toString(),
          requestId,
        },
        async (tx) => {
          await this.lockOwners(tx);
          if ((await this.rows().countDocuments({}, { session: session(tx) })) !== 0)
            throw new ApplicationError(
              "CONFLICT",
              "Bootstrap is only allowed on an empty admin collection",
            );
          return this.insert(
            id,
            {
              username: values.username,
              displayName: values.displayName,
              phone: values.phone,
              role: values.role,
            },
            hash,
            tx,
          );
        },
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("UNAVAILABLE", "Admin bootstrap failed");
    }
  }
  private async insert(
    id: Types.ObjectId,
    values: Omit<AdminCreate, "password">,
    hash: string,
    tx: TransactionContext,
  ): Promise<AdminDetails> {
    const timestamp = this.now();
    const row: Row = {
      _id: id,
      ...values,
      passwordHash: hash,
      status: "active",
      authVersion: 1,
      authorizationGuard: 0,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      __v: 0,
    };
    await this.rows().insertOne(row, { session: session(tx) });
    return dto(row);
  }
  async list(token: string | null, page: number, limit: number) {
    await this.authorize(token, "admins.read");
    const filter = { deletedAt: null };
    const [rows, total] = await Promise.all([
      this.rows()
        .find(filter, { projection: { passwordHash: 0, authVersion: 0, authorizationGuard: 0 } })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.rows().countDocuments(filter),
    ]);
    return { items: rows.map(dto), total };
  }
  async create(
    token: string | null,
    values: Omit<AdminCreate, "password">,
    hash: string,
    requestId: string,
  ) {
    const id = new Types.ObjectId();
    return this.mutation(token, "admin.created", id.toString(), requestId, (tx) =>
      this.insert(id, values, hash, tx),
    );
  }
  private async target(id: string, tx: TransactionContext, revision?: number) {
    const row = await this.rows().findOne(
      { _id: new Types.ObjectId(id), deletedAt: null },
      { session: session(tx) },
    );
    if (!row) throw new ApplicationError("NOT_FOUND", "Admin not found");
    if (revision !== undefined && row.__v !== revision)
      throw new ApplicationError("CONFLICT", "Admin changed; reload before updating");
    return row;
  }
  async update(token: string | null, id: string, input: AdminUpdate, requestId: string) {
    return this.mutation(token, "admin.updated", id, requestId, async (tx) => {
      const prior = await this.target(id, tx, input.revision);
      await this.protectOwner(prior, input.role, input.status, false, tx);
      const values = {
        username: input.username,
        displayName: input.displayName,
        phone: input.phone,
        role: input.role,
        status: input.status,
      };
      const authorityChanged =
        values.role !== prior.role ||
        values.status !== prior.status ||
        values.username !== prior.username;
      const row = await this.rows().findOneAndUpdate(
        { _id: prior._id, __v: input.revision },
        {
          $set: { ...values, updatedAt: this.now() },
          $inc: { __v: 1, authVersion: authorityChanged ? 1 : 0 },
        },
        { session: session(tx), returnDocument: "after" },
      );
      if (!row) throw new ApplicationError("CONFLICT", "Admin revision conflict");
      if (authorityChanged) await this.revoke(tx, id);
      return dto(row);
    });
  }
  async delete(token: string | null, id: string, revision: number, requestId: string) {
    return this.mutation(token, "admin.deleted", id, requestId, async (tx) => {
      const prior = await this.target(id, tx, revision);
      await this.protectOwner(prior, prior.role, prior.status, true, tx);
      await this.rows().updateOne(
        { _id: prior._id },
        {
          $set: { status: "disabled", deletedAt: this.now(), updatedAt: this.now() },
          $inc: { __v: 1, authVersion: 1 },
        },
        { session: session(tx) },
      );
      await this.revoke(tx, id);
    });
  }
  async resetPassword(token: string | null, id: string, hash: string, requestId: string) {
    return this.mutation(token, "admin.password_reset", id, requestId, async (tx) => {
      const prior = await this.target(id, tx);
      await this.rows().updateOne(
        { _id: prior._id },
        { $set: { passwordHash: hash, updatedAt: this.now() }, $inc: { __v: 1, authVersion: 1 } },
        { session: session(tx) },
      );
      await this.revoke(tx, id);
    });
  }
}
