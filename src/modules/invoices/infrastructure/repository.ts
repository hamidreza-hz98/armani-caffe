import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { AdminAuthorizer } from "../../../shared/security-ports.ts";
import {
  type ConfirmedOrderSource,
  type InvoiceIdentity,
  type IssuedInvoice,
  makeIssuedInvoice,
} from "../domain/snapshot.ts";

export type InvoicePorts = {
  settings: (session: ClientSession) => Promise<{
    identity: InvoiceIdentity;
    paperWidthMm: 58 | 80;
    printing: { automatic: boolean; printerId: string };
  }>;
  admin: AdminAuthorizer;
  customer: (token: string | null, session: ClientSession) => Promise<{ id: string }>;
  record: (
    session: ClientSession,
    actor: { kind: "admin" | "system"; id: string | null },
    event: string,
    invoiceId: string,
    orderId: string,
    requestId: string,
    reprint?: { id: string; paperWidthMm: 58 | 80 },
  ) => Promise<void>;
};
type Row = Omit<IssuedInvoice, "id" | "orderId" | "customerId" | "issuedAt"> & {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  customerId: Types.ObjectId;
  issuedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
type Reprint = {
  _id: Types.ObjectId;
  invoiceId: Types.ObjectId;
  orderId: Types.ObjectId;
  actorId: Types.ObjectId;
  idempotencyKey: string;
  paperWidthMm: 58 | 80;
  requestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
const oid = (id: string) => new Types.ObjectId(id);
const dto = (row: Row): IssuedInvoice => ({
  id: String(row._id),
  orderId: String(row.orderId),
  customerId: String(row.customerId),
  snapshotVersion: row.snapshotVersion,
  number: row.number,
  orderCode: row.orderCode,
  identity: {
    title: row.identity.title,
    legalName: row.identity.legalName,
    address: row.identity.address,
    phone: row.identity.phone,
    email: row.identity.email,
    footer: row.identity.footer,
  },
  customer: { displayName: row.customer.displayName, phone: row.customer.phone },
  lines: row.lines.map((line) => ({
    productName: line.productName,
    categoryName: line.categoryName,
    quantity: line.quantity,
    note: line.note ?? "",
    unitPriceToman: line.unitPriceToman,
    lineTotalToman: line.lineTotalToman,
    additions: line.additions.map((addition) => ({
      name: addition.name,
      priceToman: addition.priceToman,
    })),
  })),
  pricing: { ...row.pricing },
  totalToman: row.totalToman,
  transaction: { provider: row.transaction.provider, reference: row.transaction.reference },
  notes: row.notes,
  issuedAt: row.issuedAt.toISOString() as IssuedInvoice["issuedAt"],
  jalaliDateTime: row.jalaliDateTime,
  paperWidthMm: row.paperWidthMm,
  printing: row.printing ?? { automatic: false, printerId: "" },
  status: row.status,
});
const reprintDto = (row: Reprint) => ({
  id: String(row._id),
  invoiceId: String(row.invoiceId),
  orderId: String(row.orderId),
  paperWidthMm: row.paperWidthMm,
  requestedAt: row.requestedAt.toISOString(),
});
function assertV2(row: Row | null): asserts row is Row {
  if (!row) throw new ApplicationError("NOT_FOUND", "Invoice not found");
  if (row.snapshotVersion !== 2)
    throw new ApplicationError("UNAVAILABLE", "Legacy invoice requires reconciliation");
}
export class MongoInvoiceRepository {
  private readonly connection: Connection;
  private readonly ports: InvoicePorts;
  private readonly now: () => Date;
  constructor(connection: Connection, ports: InvoicePorts, now: () => Date = () => new Date()) {
    this.connection = connection;
    this.ports = ports;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("invoices");
  }
  private reprints() {
    return this.connection.db!.collection<Reprint>("invoice_reprints");
  }
  private async ready(session: ClientSession) {
    if (!session.inTransaction())
      throw new ApplicationError("VALIDATION", "Invoice requires transaction");
    if (
      !(await this.connection
        .db!.collection<{ _id: number }>("_schema_migrations")
        .findOne({ _id: 12 }, { session }))
    )
      throw new ApplicationError("UNAVAILABLE", "Apply invoice migration 12");
  }
  private transaction<T>(run: (session: ClientSession) => Promise<T>) {
    return this.connection.transaction(
      async (session) => {
        await this.ready(session);
        return run(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  }
  /** Called only by trusted order confirmation in its already-active transaction. */
  async issueInside(
    session: ClientSession,
    source: ConfirmedOrderSource,
    requestId: string,
  ): Promise<IssuedInvoice> {
    await this.ready(session);
    const prior = await this.rows().findOne({ orderId: oid(source.id) }, { session });
    if (prior) {
      assertV2(prior);
      return dto(prior);
    }
    const snapshot = makeIssuedInvoice(source, await this.ports.settings(session)),
      timestamp = this.now();
    const row: Row = {
      ...snapshot,
      _id: new Types.ObjectId(),
      orderId: oid(source.id),
      customerId: oid(source.customer.id),
      issuedAt: new Date(snapshot.issuedAt),
      createdAt: timestamp,
      updatedAt: timestamp,
      __v: 0,
    };
    await this.rows().insertOne(row, { session });
    await this.ports.record(
      session,
      { kind: "system", id: null },
      "invoice.issued",
      String(row._id),
      source.id,
      requestId,
    );
    return dto(row);
  }
  /** An at-least-once order-confirmed event observes the same durable invoice. */
  async onOrderConfirmed(orderId: string): Promise<IssuedInvoice> {
    if (!/^[a-f\d]{24}$/u.test(orderId))
      throw new ApplicationError("VALIDATION", "Invalid order ID");
    return this.transaction(async (session) => {
      const row = await this.rows().findOne({ orderId: oid(orderId) }, { session });
      if (!row)
        throw new ApplicationError(
          "UNAVAILABLE",
          "Confirmed order has no invoice; reconcile before replay",
        );
      assertV2(row);
      return dto(row);
    });
  }
  async read(token: string | null, orderId: string, customer: boolean): Promise<IssuedInvoice> {
    if (!/^[a-f\d]{24}$/u.test(orderId))
      throw new ApplicationError("VALIDATION", "Invalid order ID");
    return this.transaction(async (session) => {
      const filter = customer
        ? { customerId: oid((await this.ports.customer(token, session)).id) }
        : (await this.ports.admin(token, "invoices.read", session), {});
      const row = await this.rows().findOne({ orderId: oid(orderId), ...filter }, { session });
      assertV2(row);
      return dto(row);
    });
  }
  async reprint(
    token: string | null,
    orderId: string,
    input: { idempotencyKey: string; paperWidthMm?: 58 | 80 },
    requestId: string,
  ) {
    if (!/^[a-f\d]{24}$/u.test(orderId))
      throw new ApplicationError("VALIDATION", "Invalid order ID");
    if (
      !/^[a-zA-Z0-9_-]{8,100}$/u.test(input.idempotencyKey) ||
      (input.paperWidthMm !== undefined && input.paperWidthMm !== 58 && input.paperWidthMm !== 80)
    )
      throw new ApplicationError("VALIDATION", "Invalid reprint command");
    const attempt = async () =>
      this.transaction(async (session) => {
        const actor = await this.ports.admin(token, "invoices.reprint", session);
        const invoice = await this.rows().findOne({ orderId: oid(orderId) }, { session });
        assertV2(invoice);
        const width = input.paperWidthMm ?? invoice.paperWidthMm;
        const prior = await this.reprints().findOne(
          { actorId: oid(actor.id), idempotencyKey: input.idempotencyKey },
          { session },
        );
        if (prior) {
          if (String(prior.orderId) !== orderId || prior.paperWidthMm !== width)
            throw new ApplicationError("CONFLICT", "Reprint key belongs to another request");
          return reprintDto(prior);
        }
        const timestamp = this.now();
        const row: Reprint = {
          _id: new Types.ObjectId(),
          invoiceId: invoice._id,
          orderId: invoice.orderId,
          actorId: oid(actor.id),
          idempotencyKey: input.idempotencyKey,
          paperWidthMm: width,
          requestedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          __v: 0,
        };
        await this.reprints().insertOne(row, { session });
        await this.ports.record(
          session,
          { kind: "admin", id: actor.id },
          "invoice.reprint_requested",
          String(invoice._id),
          orderId,
          requestId,
          { id: String(row._id), paperWidthMm: width },
        );
        return reprintDto(row);
      });
    try {
      return await attempt();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        const actor = await this.transaction((session) =>
          this.ports.admin(token, "invoices.reprint", session),
        );
        const prior = await this.reprints().findOne({
          actorId: oid(actor.id),
          idempotencyKey: input.idempotencyKey,
        });
        const invoice = await this.rows().findOne({ orderId: oid(orderId) });
        if (
          prior &&
          invoice &&
          String(prior.orderId) === orderId &&
          prior.paperWidthMm === (input.paperWidthMm ?? invoice.paperWidthMm)
        )
          return reprintDto(prior);
        throw new ApplicationError("CONFLICT", "Reprint key belongs to another request");
      }
      throw error;
    }
  }
}
