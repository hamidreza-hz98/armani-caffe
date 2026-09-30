import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { AdminAuthorizer } from "../../../shared/security-ports.ts";
import type { OrderOperations } from "../application/service.ts";
import type { checkoutCommand, refundCommand, transitionCommand } from "../contracts/commands.ts";
import {
  assertPricing,
  type CheckoutState,
  type CheckoutView,
  type CustomerSnapshot,
  orderCode,
  type OrderView,
  type PricingSnapshot,
  type StockLine,
} from "../domain/confirmation.ts";
import { assertOrderTransition, type OrderItemSnapshot } from "../domain/model.ts";

export type OrderPorts = {
  customer: (token: string | null, session: ClientSession) => Promise<{ id: string }>;
  admin: AdminAuthorizer;
  quote: (
    session: ClientSession,
    customerId: string,
    cartId: string,
    revision: number,
  ) => Promise<{
    customer: CustomerSnapshot;
    items: readonly OrderItemSnapshot[];
    pricing: PricingSnapshot;
    stock: StockLine[];
    notes: string;
  }>;
  freeze: (
    session: ClientSession,
    cartId: string,
    customerId: string,
    revision: number,
    checkoutId: string,
  ) => Promise<void>;
  available: (session: ClientSession, cartId: string, checkoutId: string) => Promise<boolean>;
  close: (session: ClientSession, cartId: string, checkoutId: string) => Promise<void>;
  receipt: (
    session: ClientSession,
    id: string,
  ) => Promise<{
    id: string;
    orderId: string;
    status: string;
    amountToman: number;
    provider: string;
    reference: string | null;
  }>;
  canConsume: (session: ClientSession, stock: readonly StockLine[]) => Promise<boolean>;
  consume: (
    session: ClientSession,
    id: string,
    stock: readonly StockLine[],
    requestId: string,
  ) => Promise<void>;
  reverse: (session: ClientSession, id: string, requestId: string) => Promise<void>;
  invoice: (session: ClientSession, order: OrderView, requestId: string) => Promise<void>;
  record: (
    session: ClientSession,
    id: string,
    event: string,
    requestId: string,
    actor: { kind: "system" | "admin" | "customer"; id: string | null },
  ) => Promise<void>;
};
type Intent = {
  _id: Types.ObjectId;
  cartId: Types.ObjectId;
  customerId: Types.ObjectId;
  key: string;
  cartRevision: number;
  customer: CustomerSnapshot;
  items: readonly OrderItemSnapshot[];
  pricing: PricingSnapshot;
  stock: StockLine[];
  notes: string;
  state: CheckoutState;
  recovery: CheckoutView["recovery"];
  transactionId: string | null;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
};
type PersistedItem = Omit<OrderItemSnapshot, "productId" | "additions"> & {
  productId: Types.ObjectId;
  additions: readonly (Omit<OrderItemSnapshot["additions"][number], "additionId"> & {
    additionId: Types.ObjectId;
  })[];
};
type Row = {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  cartId: Types.ObjectId;
  transactionId: Types.ObjectId;
  checkoutId: Types.ObjectId;
  items: readonly PersistedItem[];
  code: string;
  customer: CustomerSnapshot;
  pricing: PricingSnapshot;
  transaction: OrderView["transaction"];
  notes: string;
  status: OrderView["status"];
  paymentStatus: OrderView["paymentStatus"];
  refundStatus: OrderView["refundStatus"];
  __v: number;
  placedAt: Date;
  updatedAt: Date;
  createdAt: Date;
  totalToman: number;
  idempotencyKey: string;
  snapshotVersion: 1;
};
const oid = (id: string) => new Types.ObjectId(id);
const checkoutDto = (r: Intent): CheckoutView => ({
  id: String(r._id),
  cartId: String(r.cartId),
  state: r.state,
  totalToman: r.pricing.totalToman,
  recovery: r.recovery,
  orderId: r.state === "CONFIRMED" ? String(r._id) : null,
  revision: r.__v,
});
const orderDto = (r: Row): OrderView => ({
  id: String(r._id),
  code: r.code,
  customer: r.customer,
  items: r.items.map((i) => ({
    ...i,
    productId: String(i.productId),
    additions: i.additions.map((a) => ({ ...a, additionId: String(a.additionId) })),
  })),
  pricing: r.pricing,
  transaction: r.transaction,
  notes: r.notes,
  status: r.status,
  paymentStatus: r.paymentStatus,
  refundStatus: r.refundStatus,
  revision: r.__v,
  placedAt: r.placedAt.toISOString(),
});
export class MongoOrderRepository implements OrderOperations {
  private readonly connection: Connection;
  private readonly ports: OrderPorts;
  private readonly now: () => Date;
  constructor(connection: Connection, ports: OrderPorts, now: () => Date = () => new Date()) {
    this.connection = connection;
    this.ports = ports;
    this.now = now;
  }
  private intents() {
    return this.connection.db!.collection<Intent>("checkout_intents");
  }
  private orders() {
    return this.connection.db!.collection<Row>("orders");
  }
  private async tx<T>(run: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.connection.transaction(
      async (session) => {
        if (
          !(await this.connection
            .db!.collection<{ _id: number }>("_schema_migrations")
            .findOne({ _id: 11 }, { session }))
        )
          throw new ApplicationError("UNAVAILABLE", "Apply order migration 11");
        return run(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  }
  async checkout(
    token: string | null,
    command: ReturnType<typeof checkoutCommand>,
    requestId: string,
  ) {
    return this.tx(async (session) => {
      const actor = await this.ports.customer(token, session);
      const prior = await this.intents().findOne(
        { customerId: oid(actor.id), key: command.idempotencyKey },
        { session },
      );
      if (prior) {
        if (String(prior.cartId) !== command.cartId || prior.cartRevision !== command.revision)
          throw new ApplicationError("CONFLICT", "Checkout retry differs");
        return checkoutDto(prior);
      }
      const quote = await this.ports.quote(session, actor.id, command.cartId, command.revision);
      assertPricing(quote.items, quote.pricing);
      if (!quote.pricing.totalToman)
        throw new ApplicationError("VALIDATION", "Positive payable total required");
      const row: Intent = {
        ...quote,
        _id: new Types.ObjectId(),
        cartId: oid(command.cartId),
        customerId: oid(actor.id),
        cartRevision: command.revision,
        key: command.idempotencyKey,
        state: "PAYMENT_PENDING",
        recovery: null,
        transactionId: null,
        __v: 0,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      await this.ports.freeze(session, command.cartId, actor.id, command.revision, String(row._id));
      await this.intents().insertOne(row, { session });
      await this.ports.record(session, String(row._id), "checkout.created", requestId, {
        kind: "customer",
        id: actor.id,
      });
      return checkoutDto(row);
    });
  }
  async checkoutView(token: string | null, id: string) {
    return this.tx(async (session) => {
      const actor = await this.ports.customer(token, session);
      const row = await this.intents().findOne(
        { _id: oid(id), customerId: oid(actor.id) },
        { session },
      );
      if (!row) throw new ApplicationError("NOT_FOUND", "Checkout not found");
      return checkoutDto(row);
    });
  }
  async paymentIntent(id: string, session: ClientSession) {
    if (!session.inTransaction())
      throw new ApplicationError("VALIDATION", "Payment intent requires transaction");
    if (
      !(await this.connection
        .db!.collection<{ _id: number }>("_schema_migrations")
        .findOne({ _id: 11 }, { session }))
    )
      throw new ApplicationError("UNAVAILABLE", "Apply order migration 11");
    const row = await this.intents().findOne(
      { _id: oid(id), state: "PAYMENT_PENDING" },
      { session },
    );
    if (!row) throw new ApplicationError("CONFLICT", "Checkout is not payable");
    // Serialize payment creation with fulfillment/recovery decisions.
    await this.intents().updateOne(
      { _id: row._id, __v: row.__v },
      { $inc: { __v: 1 } },
      { session },
    );
    return { amountToman: row.pricing.totalToman };
  }
  async confirmInside(
    session: ClientSession,
    transactionId: string,
    requestId: string,
  ): Promise<CheckoutView> {
    if (!session.inTransaction())
      throw new ApplicationError("VALIDATION", "Atomic confirmation requires transaction");
    if (
      !(await this.connection
        .db!.collection<{ _id: number }>("_schema_migrations")
        .findOne({ _id: 11 }, { session }))
    )
      throw new ApplicationError("UNAVAILABLE", "Apply order migration 11");
    const payment = await this.ports.receipt(session, transactionId);
    const intent = await this.intents().findOne({ _id: oid(payment.orderId) }, { session });
    if (
      !intent ||
      payment.amountToman !== intent.pricing.totalToman ||
      (intent.transactionId && intent.transactionId !== payment.id)
    )
      throw new ApplicationError("CONFLICT", "Payment does not match checkout");
    if (
      intent.state === "CONFIRMED" ||
      intent.state === "REFUND_REQUESTED" ||
      intent.state === "REFUNDED"
    )
      return checkoutDto(intent);
    if (payment.status !== "succeeded")
      throw new ApplicationError("CONFLICT", "Successful verification required");
    assertPricing(intent.items, intent.pricing);
    const recovery = !(await this.ports.available(
      session,
      String(intent.cartId),
      String(intent._id),
    ))
      ? "CART_UNAVAILABLE"
      : !(await this.ports.canConsume(session, intent.stock))
        ? "INSUFFICIENT_STOCK"
        : null;
    if (recovery) {
      const first = intent.state !== "RECOVERY_REQUIRED" || intent.recovery !== recovery;
      await this.intents().updateOne(
        { _id: intent._id, __v: intent.__v },
        {
          $set: { state: "RECOVERY_REQUIRED", recovery, transactionId, updatedAt: this.now() },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (first)
        await this.ports.record(session, String(intent._id), "order.recovery_required", requestId, {
          kind: "system",
          id: null,
        });
      return checkoutDto({ ...intent, state: "RECOVERY_REQUIRED", recovery, __v: intent.__v + 1 });
    }
    if (intent.stock.length)
      await this.ports.consume(session, String(intent._id), intent.stock, requestId);
    const counter = await this.connection
      .db!.collection<{ _id: string; sequence: number }>("order_counters")
      .findOneAndUpdate(
        { _id: "orders" },
        { $inc: { sequence: 1 } },
        { upsert: true, session, returnDocument: "after" },
      );
    const row: Row = {
      _id: intent._id,
      checkoutId: intent._id,
      customerId: intent.customerId,
      cartId: intent.cartId,
      transactionId: oid(transactionId),
      transaction: { id: transactionId, provider: payment.provider, reference: payment.reference! },
      customer: intent.customer,
      items: intent.items.map((i) => ({
        ...i,
        productId: oid(i.productId),
        additions: i.additions.map((a) => ({
          ...a,
          additionId: oid(a.additionId),
        })),
      })),
      pricing: intent.pricing,
      totalToman: intent.pricing.totalToman,
      notes: intent.notes,
      status: "NEW",
      paymentStatus: "paid",
      refundStatus: "NONE",
      code: orderCode(counter!.sequence),
      idempotencyKey: `checkout:${intent._id}`,
      snapshotVersion: 1,
      __v: 0,
      placedAt: this.now(),
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    await this.orders().insertOne(row, { session });
    await this.ports.invoice(session, orderDto(row), requestId);
    await this.sales(session, row, 1);
    await this.ports.close(session, String(intent.cartId), String(intent._id));
    await this.intents().updateOne(
      { _id: intent._id, __v: intent.__v },
      {
        $set: { state: "CONFIRMED", recovery: null, transactionId, updatedAt: this.now() },
        $inc: { __v: 1 },
      },
      { session },
    );
    await this.ports.record(session, String(intent._id), "order.confirmed", requestId, {
      kind: "system",
      id: null,
    });
    return checkoutDto({ ...intent, state: "CONFIRMED", recovery: null, __v: intent.__v + 1 });
  }
  confirm(transactionId: string, requestId: string) {
    return this.tx((session) => this.confirmInside(session, transactionId, requestId));
  }
  private async sales(session: ClientSession, row: Row, sign: 1 | -1) {
    const counts = new Map<string, number>();
    for (const item of row.items)
      counts.set(String(item.productId), (counts.get(String(item.productId)) ?? 0) + item.quantity);
    for (const [id, count] of [...counts].sort())
      await this.connection
        .db!.collection<{ _id: Types.ObjectId; count: number }>("order_sales_projection")
        .updateOne({ _id: oid(id) }, { $inc: { count: sign * count } }, { session, upsert: true });
  }
  async list(token: string | null, customer: boolean) {
    return this.tx(async (session) => {
      const filter = customer
        ? { customerId: oid((await this.ports.customer(token, session)).id) }
        : (await this.ports.admin(token, "orders.read", session), {});
      return (
        await this.orders()
          .find(filter, { session })
          .sort({ placedAt: -1, _id: -1 })
          .limit(50)
          .maxTimeMS(2500)
          .toArray()
      ).map(orderDto);
    });
  }
  async detail(token: string | null, id: string, customer: boolean) {
    return this.tx(async (session) => {
      const filter = customer
        ? { customerId: oid((await this.ports.customer(token, session)).id) }
        : (await this.ports.admin(token, "orders.read", session), {});
      const row = await this.orders().findOne({ _id: oid(id), ...filter }, { session });
      if (!row) throw new ApplicationError("NOT_FOUND", "Order not found");
      return orderDto(row);
    });
  }
  async transition(
    token: string | null,
    id: string,
    command: ReturnType<typeof transitionCommand>,
    requestId: string,
  ) {
    return this.tx(async (session) => {
      const actor = await this.ports.admin(token, "orders.manage", session);
      if (command.status === "CANCELLED" && actor.role !== "OWNER")
        throw new ApplicationError("FORBIDDEN", "Owner cancellation required");
      const row = await this.orders().findOne({ _id: oid(id), __v: command.revision }, { session });
      if (!row) throw new ApplicationError("CONFLICT", "Order changed");
      try {
        assertOrderTransition(row.status, command.status);
      } catch {
        throw new ApplicationError("CONFLICT", "Invalid order transition");
      }
      if (command.status === "CANCELLED") {
        if (row.status === "NEW") await this.ports.reverse(session, id, requestId);
        await this.sales(session, row, -1);
      }
      await this.orders().updateOne(
        { _id: row._id, __v: row.__v },
        {
          $set: {
            status: command.status,
            cancellationReason: command.status === "CANCELLED" ? command.reason : null,
            updatedAt: this.now(),
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.ports.record(session, id, `order.${command.status.toLowerCase()}`, requestId, {
        kind: "admin",
        id: actor.id,
      });
      return orderDto({ ...row, status: command.status, __v: row.__v + 1 });
    });
  }
  async retryRecovery(token: string | null, id: string, requestId: string) {
    return this.tx(async (session) => {
      const actor = await this.ports.admin(token, "orders.manage", session);
      if (actor.role !== "OWNER")
        throw new ApplicationError("FORBIDDEN", "Owner recovery required");
      const intent = await this.intents().findOne(
        { _id: oid(id), state: "RECOVERY_REQUIRED" },
        { session },
      );
      if (!intent?.transactionId)
        throw new ApplicationError("CONFLICT", "No recoverable paid checkout");
      await this.ports.record(session, id, "order.recovery_retried", requestId, {
        kind: "admin",
        id: actor.id,
      });
      return this.confirmInside(session, intent.transactionId, requestId);
    });
  }
  async refund(
    token: string | null,
    id: string,
    command: ReturnType<typeof refundCommand>,
    requestId: string,
    recovery: boolean,
  ) {
    return this.tx(async (session) => {
      const actor = await this.ports.admin(token, "orders.manage", session);
      if (actor.role !== "OWNER") throw new ApplicationError("FORBIDDEN", "Owner refund required");
      if (recovery) {
        const intent = await this.intents().findOne(
          { _id: oid(id), __v: command.revision, state: "RECOVERY_REQUIRED" },
          { session },
        );
        if (!intent) throw new ApplicationError("CONFLICT", "Recovery changed");
        if (
          !intent.transactionId ||
          (await this.ports.receipt(session, intent.transactionId)).status !== "succeeded"
        )
          throw new ApplicationError("CONFLICT", "Paid recovery required");
        await this.intents().updateOne(
          { _id: intent._id },
          {
            $set: {
              state: "REFUND_REQUESTED",
              refundReason: command.reason,
              updatedAt: this.now(),
            },
            $inc: { __v: 1 },
          },
          { session },
        );
        await this.ports.record(session, id, "payment.refund_requested", requestId, {
          kind: "admin",
          id: actor.id,
        });
        return checkoutDto({ ...intent, state: "REFUND_REQUESTED", __v: intent.__v + 1 });
      }
      const row = await this.orders().findOne(
        {
          _id: oid(id),
          __v: command.revision,
          status: "CANCELLED",
          paymentStatus: "paid",
          refundStatus: "NONE",
        },
        { session },
      );
      if (!row)
        throw new ApplicationError("CONFLICT", "Only cancelled paid orders can request refund");
      if ((await this.ports.receipt(session, String(row.transactionId))).status !== "succeeded")
        throw new ApplicationError("CONFLICT", "Verified paid order required");
      await this.orders().updateOne(
        { _id: row._id },
        {
          $set: { refundStatus: "REQUESTED", refundReason: command.reason, updatedAt: this.now() },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.ports.record(session, id, "payment.refund_requested", requestId, {
        kind: "admin",
        id: actor.id,
      });
      return orderDto({ ...row, refundStatus: "REQUESTED", __v: row.__v + 1 });
    });
  }
  async recoveries(token: string | null) {
    return this.tx(async (session) => {
      const actor = await this.ports.admin(token, "orders.manage", session);
      if (actor.role !== "OWNER")
        throw new ApplicationError("FORBIDDEN", "Owner recovery required");
      return (
        await this.intents()
          .find({ state: { $in: ["RECOVERY_REQUIRED", "REFUND_REQUESTED"] } }, { session })
          .sort({ updatedAt: 1 })
          .limit(50)
          .maxTimeMS(2500)
          .toArray()
      ).map(checkoutDto);
    });
  }
  /** Trusted adapter/worker entry: never an admin supplied success flag. */
  async reconcileRefund(transactionId: string, requestId: string) {
    return this.tx(async (session) => {
      const proof = await this.ports.receipt(session, transactionId);
      if (proof.status !== "refunded")
        throw new ApplicationError("CONFLICT", "Authoritative refund evidence required");
      const intent = await this.intents().findOne(
        { _id: oid(proof.orderId), transactionId, "pricing.totalToman": proof.amountToman },
        { session },
      );
      if (!intent) throw new ApplicationError("CONFLICT", "Refund checkout mismatch");
      const row = await this.orders().findOne(
        { _id: intent._id, transactionId: oid(transactionId) },
        { session },
      );
      if (row) {
        if (row.refundStatus === "REFUNDED") return;
        if (row.status !== "CANCELLED" || row.refundStatus !== "REQUESTED")
          throw new ApplicationError("CONFLICT", "Refund was not requested");
        await this.orders().updateOne(
          { _id: row._id },
          {
            $set: { refundStatus: "REFUNDED", paymentStatus: "refunded", updatedAt: this.now() },
            $inc: { __v: 1 },
          },
          { session },
        );
      } else {
        if (intent.state === "REFUNDED") return;
        if (intent.state !== "REFUND_REQUESTED")
          throw new ApplicationError("CONFLICT", "Recovery refund was not requested");
        if (await this.ports.available(session, String(intent.cartId), String(intent._id)))
          await this.ports.close(session, String(intent.cartId), String(intent._id));
      }
      await this.intents().updateOne(
        { _id: intent._id },
        { $set: { state: "REFUNDED", updatedAt: this.now() }, $inc: { __v: 1 } },
        { session },
      );
      await this.ports.record(session, String(intent._id), "order.refunded", requestId, {
        kind: "system",
        id: null,
      });
    });
  }
}
