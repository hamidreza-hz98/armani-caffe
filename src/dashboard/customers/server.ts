import "server-only";

import { randomUUID } from "node:crypto";

import { type ClientSession, Types } from "mongoose";

import { configuredAdminSecurity, ScryptPasswords } from "@/modules/auth/server";
import { customerPhone, parseCustomerSignup } from "@/modules/customers/server";
import { commitSensitiveChange } from "@/modules/notifications/server";
import { getDatabaseConnection } from "@/server/database/connection";
import { ApplicationError } from "@/shared/errors";
import { canonicalBirthDate } from "@/shared/jalali-date";

export type CustomerFilters = {
  q: string;
  status: "all" | "active" | "blocked" | "anonymized";
  page: number;
};
export type CustomerRow = {
  id: string;
  phone: string | null;
  displayName: string | null;
  birthDate: string | null;
  status: "active" | "blocked" | "anonymized";
  revision: number;
  createdAt: string;
  lastOrderAt: string | null;
};
type DbRow = {
  _id: Types.ObjectId;
  phone: string;
  displayName: string | null;
  birthDate: Date | null;
  status: CustomerRow["status"];
  __v: number;
  createdAt: Date;
  updatedAt: Date;
  lastOrderAt: Date | null;
  passwordHash: string;
  authVersion: number;
  anonymizedAt?: Date | null;
};
type OrderRow = {
  _id: Types.ObjectId;
  code: string;
  status: string;
  paymentStatus: string;
  totalToman: number;
  placedAt: Date;
};
export type CustomerList = {
  items: CustomerRow[];
  total: number;
  stats: { total: number; active: number; blocked: number; anonymized: number };
};

const idPattern = /^[a-f0-9]{24}$/u;
const dto = (row: DbRow): CustomerRow => ({
  id: String(row._id),
  phone: row.status === "anonymized" ? null : row.phone,
  displayName: row.status === "anonymized" ? null : row.displayName,
  birthDate:
    row.status === "anonymized" ? null : (row.birthDate?.toISOString().slice(0, 10) ?? null),
  status: row.status,
  revision: row.__v,
  createdAt: row.createdAt.toISOString(),
  lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
});
const rows = async () => (await getDatabaseConnection()).db!.collection<DbRow>("customers");
function query(filters: CustomerFilters) {
  const search = filters.q.trim();
  const phone = search
    ? (() => {
        try {
          return customerPhone(search);
        } catch {
          return null;
        }
      })()
    : null;
  return {
    ...(filters.status === "all" ? {} : { status: filters.status }),
    ...(search ? (phone ? { phone } : { $text: { $search: search } }) : {}),
  };
}
export function parseCustomerFilters(raw: Record<string, string | undefined>): CustomerFilters {
  return {
    q: typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "",
    status:
      raw.status === "active" || raw.status === "blocked" || raw.status === "anonymized"
        ? raw.status
        : "all",
    page: /^\d{1,5}$/u.test(raw.page ?? "") && Number(raw.page) > 0 ? Number(raw.page) : 1,
  };
}
export async function listCustomers(filters: CustomerFilters): Promise<CustomerList> {
  if (
    filters.q.length > 80 ||
    filters.page < 1 ||
    filters.page > 10000 ||
    !Number.isSafeInteger(filters.page)
  )
    throw new ApplicationError("VALIDATION", "Invalid customer filters");
  const collection = await rows();
  const [items, total, active, blocked, anonymized] = await Promise.all([
    collection
      .find(query(filters), { projection: { passwordHash: 0, authVersion: 0 } })
      .sort({ createdAt: -1, _id: -1 })
      .skip((filters.page - 1) * 20)
      .limit(20)
      .maxTimeMS(2500)
      .toArray(),
    collection.countDocuments(query(filters), { maxTimeMS: 2500 }),
    collection.countDocuments({ status: "active" }, { maxTimeMS: 2500 }),
    collection.countDocuments({ status: "blocked" }, { maxTimeMS: 2500 }),
    collection.countDocuments({ status: "anonymized" }, { maxTimeMS: 2500 }),
  ]);
  const latest = items.length
    ? await (
        await getDatabaseConnection()
      )
        .db!.collection("orders")
        .aggregate<{ _id: Types.ObjectId; placedAt: Date }>(
          [
            {
              $match: {
                customerId: { $in: items.map((row) => row._id) },
                paymentStatus: "paid",
                status: { $ne: "CANCELLED" },
              },
            },
            { $sort: { placedAt: -1 } },
            { $group: { _id: "$customerId", placedAt: { $first: "$placedAt" } } },
          ],
          { maxTimeMS: 2500 },
        )
        .toArray()
    : [];
  const latestByCustomer = new Map(
    latest.map((row) => [String(row._id), row.placedAt.toISOString()]),
  );
  return {
    items: items.map((row) => ({
      ...dto(row),
      lastOrderAt: latestByCustomer.get(String(row._id)) ?? null,
    })),
    total,
    stats: {
      total: active + blocked + anonymized,
      active,
      blocked,
      anonymized,
    },
  };
}
export async function customerDetail(id: string) {
  if (!idPattern.test(id)) throw new ApplicationError("VALIDATION", "Invalid customer ID");
  const connection = await getDatabaseConnection();
  const collection = connection.db!.collection<DbRow>("customers");
  const orderCollection = connection.db!.collection<OrderRow>("orders");
  const customer = await collection.findOne(
    { _id: new Types.ObjectId(id) },
    { projection: { passwordHash: 0, authVersion: 0 }, maxTimeMS: 2500 },
  );
  if (!customer) throw new ApplicationError("NOT_FOUND", "Customer not found");
  const orderFilter = {
    customerId: new Types.ObjectId(id),
    paymentStatus: "paid",
    status: { $ne: "CANCELLED" },
  };
  const [metrics, recent] = await Promise.all([
    orderCollection
      .aggregate<{ count: number; spentToman: number }>(
        [
          { $match: orderFilter },
          { $group: { _id: null, count: { $sum: 1 }, spentToman: { $sum: "$totalToman" } } },
        ],
        { maxTimeMS: 2500 },
      )
      .toArray(),
    orderCollection
      .find(orderFilter, { projection: { code: 1, status: 1, totalToman: 1, placedAt: 1 } })
      .sort({ placedAt: -1, _id: -1 })
      .limit(5)
      .maxTimeMS(2500)
      .toArray(),
  ]);
  return {
    customer: dto(customer),
    metrics: { orderCount: metrics[0]?.count ?? 0, spentToman: metrics[0]?.spentToman ?? 0 },
    recentOrders: recent.map((order) => ({
      id: String(order._id),
      code: order.code,
      status: order.status,
      totalToman: order.totalToman,
      placedAt: order.placedAt.toISOString(),
    })),
  };
}
function updateInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApplicationError("VALIDATION", "Invalid customer input");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["phone", "displayName", "birthDate", "status", "revision"].includes(key),
    )
  )
    throw new ApplicationError("VALIDATION", "Invalid customer input");
  if (
    typeof value.displayName !== "string" ||
    !value.displayName.trim() ||
    value.displayName.length > 120 ||
    /[<>\u0000-\u001f\u007f]/u.test(value.displayName)
  )
    throw new ApplicationError("VALIDATION", "Invalid customer name");
  if (value.status !== "active" && value.status !== "blocked")
    throw new ApplicationError("VALIDATION", "Invalid customer status");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
    throw new ApplicationError("VALIDATION", "Invalid revision");
  try {
    return {
      phone: customerPhone(value.phone),
      displayName: value.displayName.trim().normalize("NFC"),
      birthDate: canonicalBirthDate(value.birthDate),
      status: value.status as "active" | "blocked",
      revision: value.revision as number,
    };
  } catch {
    throw new ApplicationError("VALIDATION", "Invalid phone or birth date");
  }
}
async function change<T>(
  token: string | null,
  action: string,
  id: string,
  requestId: string,
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const connection = await getDatabaseConnection();
  const security = await configuredAdminSecurity();
  const actor = await security.store.authorize(token, "customers.manage");
  const idempotencyKey = `customer-admin:${randomUUID()}`;
  try {
    return await commitSensitiveChange(connection, {
      audit: {
        actor: { kind: "admin", id: actor.id },
        area: "customer",
        action,
        subject: { kind: "customer", id },
        requestId,
        idempotencyKey,
        metadata: {},
      },
      events: [
        {
          actor: { kind: "admin", id: actor.id },
          aggregateKind: "customer",
          aggregateId: id,
          eventType: action,
          payload: { customerId: id },
          requestId,
          idempotencyKey,
        },
      ],
      change: async (session) => {
        await security.store.authorize(token, "customers.manage", session);
        return operation(session);
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === 11000)
      throw new ApplicationError("CONFLICT", "Customer mobile already exists");
    throw new ApplicationError("UNAVAILABLE", "Customer change failed");
  }
}
export async function createCustomer(token: string | null, input: unknown, requestId: string) {
  const parsed = parseCustomerSignup(input);
  if (!parsed.displayName) throw new ApplicationError("VALIDATION", "Customer name required");
  const hash = await new ScryptPasswords().hash(parsed.password);
  const id = new Types.ObjectId().toString();
  return change(token, "customer.admin_created", id, requestId, async (session) => {
    const connection = await getDatabaseConnection();
    const timestamp = new Date();
    const row: DbRow = {
      _id: new Types.ObjectId(id),
      phone: parsed.phone,
      displayName: parsed.displayName,
      birthDate: parsed.birthDate ? new Date(`${parsed.birthDate}T00:00:00.000Z`) : null,
      passwordHash: hash,
      status: "active",
      authVersion: 1,
      lastOrderAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      __v: 0,
    };
    await connection.db!.collection<DbRow>("customers").insertOne(row, { session });
    return dto(row);
  });
}
export async function updateCustomer(
  token: string | null,
  id: string,
  input: unknown,
  requestId: string,
) {
  if (!idPattern.test(id)) throw new ApplicationError("VALIDATION", "Invalid customer ID");
  const values = updateInput(input);
  return change(token, "customer.admin_updated", id, requestId, async (session) => {
    const timestamp = new Date();
    const previous = await (await rows()).findOne({ _id: new Types.ObjectId(id) }, { session });
    if (!previous) throw new ApplicationError("NOT_FOUND", "Customer not found");
    if (previous.status === "anonymized")
      throw new ApplicationError("CONFLICT", "Anonymized customer cannot be edited");
    const changedAuthority = previous.phone !== values.phone || previous.status !== values.status;
    const result = await (
      await rows()
    ).findOneAndUpdate(
      { _id: previous._id, __v: values.revision },
      {
        $set: {
          phone: values.phone,
          displayName: values.displayName,
          birthDate: values.birthDate ? new Date(`${values.birthDate}T00:00:00.000Z`) : null,
          status: values.status,
          updatedAt: timestamp,
        },
        $inc: { __v: 1, authVersion: changedAuthority ? 1 : 0 },
      },
      { session, returnDocument: "after" },
    );
    if (!result) throw new ApplicationError("CONFLICT", "Customer changed");
    if (changedAuthority)
      await (
        await getDatabaseConnection()
      )
        .db!.collection("sessions")
        .updateMany(
          { principalKind: "customer", principalId: previous._id, revokedAt: null },
          { $set: { revokedAt: timestamp, updatedAt: timestamp } },
          { session },
        );
    return dto(result);
  });
}
export async function anonymizeCustomer(
  token: string | null,
  id: string,
  revision: number,
  requestId: string,
) {
  if (!idPattern.test(id) || !Number.isSafeInteger(revision) || revision < 0)
    throw new ApplicationError("VALIDATION", "Invalid customer deletion");
  return change(token, "customer.anonymized", id, requestId, async (session) => {
    const timestamp = new Date();
    const result = await (
      await rows()
    ).findOneAndUpdate(
      { _id: new Types.ObjectId(id), __v: revision, status: { $ne: "anonymized" } },
      {
        $set: {
          phone: `anon:${id}`,
          displayName: null,
          birthDate: null,
          passwordHash: `disabled:${randomUUID()}`,
          status: "anonymized",
          anonymizedAt: timestamp,
          updatedAt: timestamp,
        },
        $inc: { __v: 1, authVersion: 1 },
      },
      { session, returnDocument: "after" },
    );
    if (!result) throw new ApplicationError("CONFLICT", "Customer changed or already anonymized");
    await (
      await getDatabaseConnection()
    )
      .db!.collection("sessions")
      .updateMany(
        { principalKind: "customer", principalId: new Types.ObjectId(id), revokedAt: null },
        { $set: { revokedAt: timestamp, updatedAt: timestamp } },
        { session },
      );
    return dto(result);
  });
}
