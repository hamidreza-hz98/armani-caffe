import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { asUtcTimestamp } from "../../../shared/domain.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { TransactionContext } from "../../../shared/security-ports.ts";
import type { Customer } from "../domain/model.ts";

type Row = {
  _id: Types.ObjectId;
  phone: string;
  passwordHash: string;
  displayName: string | null;
  birthDate: Date | null;
  status: "active" | "blocked" | "anonymized";
  authVersion: number;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
const mongoSession = (tx?: TransactionContext) => tx as ClientSession | undefined;
const dto = (row: Row): Customer => ({
  id: row._id.toString(),
  phone: row.phone,
  displayName: row.displayName,
  birthDate: row.birthDate?.toISOString().slice(0, 10) ?? null,
  status: row.status,
  revision: row.__v,
  createdAt: asUtcTimestamp(row.createdAt.toISOString()),
  updatedAt: asUtcTimestamp(row.updatedAt.toISOString()),
});
export type CustomerIdentity = {
  id: string;
  phone: string;
  status: "active" | "blocked" | "anonymized";
  authVersion: number;
  passwordHash: string;
};
function identity(row: Row | null): CustomerIdentity | null {
  if (!row || !Number.isSafeInteger(row.authVersion) || row.authVersion < 1) return null;
  return {
    id: row._id.toString(),
    phone: row.phone,
    status: row.status,
    authVersion: row.authVersion,
    passwordHash: row.passwordHash,
  };
}
export class MongoCustomerRepository {
  async orderSnapshot(id: string, session: ClientSession) {
    const row = await this.rows().findOne(
      { _id: new Types.ObjectId(id), status: "active" },
      { session, projection: { phone: 1, displayName: 1 } },
    );
    if (!row) throw new ApplicationError("UNAUTHORIZED", "Customer unavailable");
    return { id, displayName: row.displayName, phone: row.phone };
  }
  private readonly connection: Connection;
  private readonly now: () => Date;
  constructor(connection: Connection, now: () => Date = () => new Date()) {
    this.connection = connection;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("customers");
  }
  byPhone(phone: string) {
    return this.rows().findOne({ phone }).then(identity);
  }
  byId(id: string, tx?: TransactionContext) {
    return this.rows()
      .findOne({ _id: new Types.ObjectId(id) }, { session: mongoSession(tx) })
      .then(identity);
  }
  async create(
    id: string,
    values: { phone: string; displayName: string | null; birthDate: string | null },
    passwordHash: string,
    tx: TransactionContext,
  ): Promise<Customer> {
    const timestamp = this.now();
    const row: Row = {
      _id: new Types.ObjectId(id),
      ...values,
      passwordHash,
      birthDate: values.birthDate ? new Date(`${values.birthDate}T00:00:00.000Z`) : null,
      status: "active",
      authVersion: 1,
      lastOrderAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      __v: 0,
    };
    await this.rows().insertOne(row, { session: mongoSession(tx) });
    return dto(row);
  }
  async profile(id: string): Promise<Customer> {
    const row = await this.rows().findOne({ _id: new Types.ObjectId(id), status: "active" });
    if (!row) throw new ApplicationError("UNAUTHORIZED", "Customer unavailable");
    return dto(row);
  }
  async update(
    id: string,
    values: {
      revision: number;
      displayName?: string | null;
      birthDate?: string | null;
    },
    tx: TransactionContext,
  ): Promise<Customer> {
    const fields: { displayName?: string | null; birthDate?: Date | null; updatedAt: Date } = {
      updatedAt: this.now(),
    };
    if ("displayName" in values) fields.displayName = values.displayName;
    if ("birthDate" in values)
      fields.birthDate = values.birthDate ? new Date(`${values.birthDate}T00:00:00.000Z`) : null;
    const row = await this.rows().findOneAndUpdate(
      { _id: new Types.ObjectId(id), status: "active", __v: values.revision },
      { $set: fields, $inc: { __v: 1 } },
      { returnDocument: "after", session: mongoSession(tx) },
    );
    if (!row) throw new ApplicationError("CONFLICT", "Profile revision conflict");
    return dto(row);
  }
}
