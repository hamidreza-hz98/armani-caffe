import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";

import { type ClientSession, type Connection, Types } from "mongoose";

import { asToman } from "../../../shared/domain.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { ProviderConfiguration } from "../application/provider.ts";
import type { PaymentRepository, PaymentWork } from "../application/service.ts";
import type { PaymentIssue, PaymentView } from "../domain/framework.ts";
import { assertTransactionTransition, type TransactionStatus } from "../domain/model.ts";

export type PaymentPorts = {
  /** Must read a durable, server-priced payable intent under this transaction. */
  intent: (orderId: string, session: ClientSession) => Promise<{ amountToman: number }>;
  configuration: () => Promise<ProviderConfiguration>;
  seal: (configuration: ProviderConfiguration) => string | null;
  open: (
    provider: string,
    mode: "sandbox" | "production",
    encrypted: string | null,
  ) => ProviderConfiguration;
  callbackKeyId: string;
  callbackToken: (id: string, keyId: string) => string;
  callbackBaseUrl: string;
  record: (
    session: ClientSession,
    view: PaymentView,
    event: string,
    requestId: string,
  ) => Promise<void>;
};
type Row = {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  provider: string;
  amountToman: number;
  status: TransactionStatus;
  idempotencyKey: string;
  authority: string | null;
  providerReference: string | null;
  redirectUrl: string | null;
  providerMode: "sandbox" | "production";
  encryptedCredential: string | null;
  callbackBaseUrl: string;
  callbackKeyId: string;
  issue: PaymentIssue;
  lockedUntil: Date | null;
  claimToken: string | null;
  creationAttempts: number;
  verificationAttempts: number;
  frameworkVersion: number;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
const dto = (row: Row): PaymentView => ({
  id: String(row._id),
  orderId: String(row.orderId),
  provider: row.provider,
  amountToman: row.amountToman,
  status: row.status,
  authority: row.authority,
  reference: row.providerReference,
  redirectUrl: row.redirectUrl,
  issue: row.issue,
  revision: row.__v,
});
export class MongoPaymentRepository implements PaymentRepository {
  private readonly connection: Connection;
  private readonly ports: PaymentPorts;
  private readonly now: () => Date;
  constructor(connection: Connection, ports: PaymentPorts, now: () => Date = () => new Date()) {
    this.connection = connection;
    this.ports = ports;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("transactions");
  }
  private async transaction<T>(run: (session: ClientSession) => Promise<T>): Promise<T> {
    try {
      return await this.connection.transaction(
        async (session) => {
          if (
            !(await this.connection
              .db!.collection<{ _id: number }>("_schema_migrations")
              .findOne({ _id: 10 }, { session }))
          )
            throw new ApplicationError("UNAVAILABLE", "Apply payment framework migration 10");
          return run(session);
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError("CONFLICT", "Payment uniqueness conflict");
      throw new ApplicationError("UNAVAILABLE", "Payment persistence unavailable");
    }
  }
  async reserve(orderId: string, key: string, requestId: string) {
    const prior = await this.rows().findOne({ idempotencyKey: key });
    if (prior) {
      if (String(prior.orderId) !== orderId || prior.frameworkVersion !== 1)
        throw new ApplicationError("CONFLICT", "Payment idempotency conflict");
      return dto(prior);
    }
    const configuration = await this.ports.configuration(),
      id = new Types.ObjectId(),
      timestamp = this.now();
    try {
      return await this.transaction(async (session) => {
        const replay = await this.rows().findOne({ idempotencyKey: key }, { session });
        if (replay) {
          if (String(replay.orderId) !== orderId)
            throw new ApplicationError("CONFLICT", "Payment idempotency conflict");
          return dto(replay);
        }
        const intent = await this.ports.intent(orderId, session),
          amountToman = asToman(intent.amountToman);
        if (!amountToman)
          throw new ApplicationError("VALIDATION", "Payable amount must be positive");
        const row: Row = {
          _id: id,
          orderId: new Types.ObjectId(orderId),
          provider: configuration.id,
          amountToman,
          status: "created",
          idempotencyKey: key,
          authority: null,
          providerReference: null,
          redirectUrl: null,
          providerMode: configuration.mode,
          encryptedCredential: this.ports.seal(configuration),
          callbackBaseUrl: this.ports.callbackBaseUrl,
          callbackKeyId: this.ports.callbackKeyId,
          issue: null,
          lockedUntil: null,
          claimToken: null,
          creationAttempts: 0,
          verificationAttempts: 0,
          frameworkVersion: 1,
          settledAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          __v: 0,
        };
        await this.rows().insertOne(row, { session });
        await this.ports.record(session, dto(row), "payment.created", requestId);
        return dto(row);
      });
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "CONFLICT") {
        const replay = await this.rows().findOne({ idempotencyKey: key });
        if (replay && String(replay.orderId) === orderId && replay.frameworkVersion === 1)
          return dto(replay);
      }
      throw error;
    }
  }
  private work(row: Row, claim: string | null): PaymentWork {
    if (row.frameworkVersion !== 1)
      throw new ApplicationError("UNAVAILABLE", "Legacy payment requires reconciliation");
    const url = new URL(`/api/payments/callback/${row.provider}/${row._id}`, row.callbackBaseUrl);
    url.searchParams.set("state", this.ports.callbackToken(String(row._id), row.callbackKeyId));
    return {
      view: dto(row),
      configuration: this.ports.open(row.provider, row.providerMode, row.encryptedCredential),
      request: {
        paymentId: String(row._id),
        idempotencyKey: row.idempotencyKey,
        amountToman: row.amountToman,
        authority: row.authority,
        callbackUrl: url.href,
      },
      claim,
      creationAttempts: row.creationAttempts,
    };
  }
  async inspect(id: string) {
    const row = await this.rows().findOne({ _id: new Types.ObjectId(id) });
    if (!row) throw new ApplicationError("NOT_FOUND", "Payment not found");
    return this.work(row, null);
  }
  callbackValid(work: PaymentWork, url: URL, state: string) {
    const expected = new URL(work.request.callbackUrl);
    const token = expected.searchParams.get("state")!;
    return (
      url.origin === expected.origin &&
      url.pathname === expected.pathname &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^[a-f\d]{64}$/u.test(state) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(state))
    );
  }
  async claim(id: string, operation: "create" | "verify", requestId: string) {
    return this.transaction(async (session) => {
      const row = await this.rows().findOne({ _id: new Types.ObjectId(id) }, { session });
      if (!row) throw new ApplicationError("NOT_FOUND", "Payment not found");
      if (
        row.status !== (operation === "create" ? "created" : "pending") ||
        (row.lockedUntil && row.lockedUntil > this.now())
      )
        return this.work(row, null);
      const claim = randomUUID(),
        timestamp = this.now();
      const updated = await this.rows().findOneAndUpdate(
        { _id: row._id, __v: row.__v },
        {
          $set: {
            claimToken: claim,
            lockedUntil: new Date(timestamp.getTime() + 30000),
            updatedAt: timestamp,
          },
          $inc: {
            __v: 1,
            ...(operation === "create" ? { creationAttempts: 1 } : { verificationAttempts: 1 }),
          },
        },
        { session, returnDocument: "after" },
      );
      if (!updated) throw new ApplicationError("CONFLICT", "Payment claim changed");
      await this.ports.record(session, dto(updated), `payment.${operation}_claimed`, requestId);
      return this.work(updated, claim);
    });
  }
  async complete(
    work: PaymentWork,
    change: {
      status?: TransactionStatus;
      authority?: string;
      redirectUrl?: string;
      reference?: string;
      issue: PaymentIssue;
    },
    requestId: string,
  ): Promise<PaymentView> {
    try {
      return await this.transaction(async (session) => {
        const row = await this.rows().findOne(
          { _id: new Types.ObjectId(work.view.id) },
          { session },
        );
        if (!row) throw new ApplicationError("NOT_FOUND", "Payment not found");
        if (
          row.claimToken !== work.claim ||
          !work.claim ||
          row.__v !== work.view.revision ||
          !row.lockedUntil ||
          row.lockedUntil <= this.now()
        )
          return dto(row);
        if (change.status) assertTransactionTransition(row.status, change.status);
        const status = change.status ?? row.status;
        const updated = await this.rows().findOneAndUpdate(
          { _id: row._id, claimToken: work.claim, __v: row.__v },
          {
            $set: {
              status,
              authority: change.authority ?? row.authority,
              providerReference: change.reference ?? row.providerReference,
              redirectUrl: change.redirectUrl ?? row.redirectUrl,
              issue: change.issue,
              settledAt: status === "succeeded" ? this.now() : row.settledAt,
              claimToken: null,
              lockedUntil: null,
              updatedAt: this.now(),
            },
            $inc: { __v: 1 },
          },
          { session, returnDocument: "after" },
        );
        if (!updated) throw new ApplicationError("CONFLICT", "Payment completion changed");
        await this.ports.record(
          session,
          dto(updated),
          change.status ? `payment.${status}` : "payment.unresolved",
          requestId,
        );
        return dto(updated);
      });
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "CONFLICT" &&
        (change.reference || change.authority)
      )
        return this.complete(work, { issue: "REFERENCE_CONFLICT" }, requestId);
      throw error;
    }
  }
}
