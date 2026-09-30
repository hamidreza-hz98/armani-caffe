import "server-only";

import { randomUUID } from "node:crypto";

import { type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";

export type PrintJobView = Readonly<{
  id: string;
  invoiceId: string;
  orderId: string;
  source: "automatic" | "reprint";
  reprintId: string | null;
  printerId: string;
  paperWidthMm: 58 | 80;
  status: "queued" | "printing" | "printed" | "dead";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  leaseUntil: string | null;
  deliveryId: string | null;
  printedAt: string | null;
  lastFailureCode: string | null;
}>;
type Row = {
  _id: Types.ObjectId;
  invoiceId: Types.ObjectId;
  orderId: Types.ObjectId;
  source: "automatic" | "reprint";
  reprintId: Types.ObjectId | null;
  printerId: string;
  paperWidthMm: 58 | 80;
  status: PrintJobView["status"];
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  deliveryId: string | null;
  printedAt: Date | null;
  acknowledgedAt: Date | null;
  lastFailureCode: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
const oid = (value: string) => new Types.ObjectId(value);
const validId = (value: string) => /^[a-f\d]{24}$/u.test(value);
const view = (row: Row): PrintJobView => ({
  id: String(row._id),
  invoiceId: String(row.invoiceId),
  orderId: String(row.orderId),
  source: row.source,
  reprintId: row.reprintId ? String(row.reprintId) : null,
  printerId: row.printerId,
  paperWidthMm: row.paperWidthMm,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.maxAttempts,
  nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
  leaseUntil: row.leaseUntil?.toISOString() ?? null,
  deliveryId: row.deliveryId,
  printedAt: row.printedAt?.toISOString() ?? null,
  lastFailureCode: row.lastFailureCode,
});
export type CreatePrintJob = {
  invoiceId: string;
  orderId: string;
  source: "automatic" | "reprint";
  reprintId?: string;
  printerId: string;
  paperWidthMm: 58 | 80;
};
export type PrintAck = {
  jobId: string;
  printerId: string;
  attempt: number;
  deliveryId: string;
  result: "printed" | "error";
  at: string;
  errorCode?: string;
};

export class MongoPrintJobs {
  private readonly connection: Connection;
  private readonly now: () => Date;
  private readonly random: () => number;
  constructor(
    connection: Connection,
    now: () => Date = () => new Date(),
    random: () => number = Math.random,
  ) {
    this.connection = connection;
    this.now = now;
    this.random = random;
  }
  private rows() {
    return this.connection.db!.collection<Row>("print_jobs");
  }
  async create(input: CreatePrintJob): Promise<PrintJobView> {
    if (
      ![input.invoiceId, input.orderId, ...(input.reprintId ? [input.reprintId] : [])].every(
        validId,
      ) ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(input.printerId) ||
      ![58, 80].includes(input.paperWidthMm) ||
      (input.source === "reprint") !== !!input.reprintId
    )
      throw new ApplicationError("VALIDATION", "Invalid print job source");
    const key =
      input.source === "automatic"
        ? `invoice:auto:${input.invoiceId}`
        : `invoice:reprint:${input.reprintId}`;
    const now = this.now();
    const row: Row = {
      _id: new Types.ObjectId(),
      invoiceId: oid(input.invoiceId),
      orderId: oid(input.orderId),
      source: input.source,
      reprintId: input.reprintId ? oid(input.reprintId) : null,
      printerId: input.printerId,
      paperWidthMm: input.paperWidthMm,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      leaseUntil: null,
      deliveryId: null,
      printedAt: null,
      acknowledgedAt: null,
      lastFailureCode: null,
      idempotencyKey: key,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    };
    let stored: Row | null;
    try {
      stored = await this.rows().findOneAndUpdate(
        { idempotencyKey: key },
        { $setOnInsert: row },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        stored = await this.rows().findOne({ idempotencyKey: key });
      else throw error;
    }
    if (!stored) throw new ApplicationError("UNAVAILABLE", "Print job creation failed");
    if (
      String(stored.invoiceId) !== input.invoiceId ||
      stored.printerId !== input.printerId ||
      stored.paperWidthMm !== input.paperWidthMm
    )
      throw new ApplicationError("CONFLICT", "Print job key changed");
    return view(stored);
  }
  async get(id: string): Promise<PrintJobView | null> {
    if (!validId(id)) return null;
    const row = await this.rows().findOne({ _id: oid(id) });
    return row ? view(row) : null;
  }
  async byOrder(orderId: string): Promise<PrintJobView[]> {
    if (!validId(orderId)) throw new ApplicationError("VALIDATION", "Invalid order ID");
    return (
      await this.rows()
        .find({ orderId: oid(orderId) })
        .sort({ createdAt: 1, _id: 1 })
        .limit(100)
        .toArray()
    ).map(view);
  }
  async scheduled(limit = 100): Promise<PrintJobView[]> {
    return (
      await this.rows()
        .find({ status: "queued", nextAttemptAt: { $lte: this.now() } })
        .sort({ nextAttemptAt: 1 })
        .limit(limit)
        .toArray()
    ).map(view);
  }
  async pending(limit = 100): Promise<PrintJobView[]> {
    return (
      await this.rows().find({ status: "queued" }).sort({ nextAttemptAt: 1 }).limit(limit).toArray()
    ).map(view);
  }
  async expired(limit = 100): Promise<PrintJobView[]> {
    return (
      await this.rows()
        .find({ status: "printing", leaseUntil: { $lte: this.now() } })
        .sort({ leaseUntil: 1 })
        .limit(limit)
        .toArray()
    ).map(view);
  }
  async claim(id: string, printerId: string, leaseMs: number): Promise<PrintJobView | null> {
    if (!validId(id) || leaseMs < 1000)
      throw new ApplicationError("VALIDATION", "Invalid print claim");
    const now = this.now(),
      deliveryId = randomUUID();
    const row = await this.rows().findOneAndUpdate(
      {
        _id: oid(id),
        printerId,
        status: "queued",
        nextAttemptAt: { $lte: now },
        attempts: { $lt: 5 },
      },
      {
        $set: {
          status: "printing",
          leaseUntil: new Date(now.getTime() + leaseMs),
          deliveryId,
          nextAttemptAt: null,
          updatedAt: now,
        },
        $inc: { attempts: 1, __v: 1 },
      },
      { returnDocument: "after" },
    );
    return row ? view(row) : null;
  }
  private backoff(attempt: number): number {
    return Math.round(Math.min(120_000, 1000 * 2 ** (attempt - 1)) * (0.75 + 0.5 * this.random()));
  }
  async fail(job: PrintJobView, code: string): Promise<PrintJobView | null> {
    const now = this.now(),
      dead = job.attempts >= job.maxAttempts;
    const row = await this.rows().findOneAndUpdate(
      { _id: oid(job.id), status: "printing", attempts: job.attempts, deliveryId: job.deliveryId },
      {
        $set: {
          status: dead ? "dead" : "queued",
          nextAttemptAt: dead ? null : new Date(now.getTime() + this.backoff(job.attempts)),
          leaseUntil: null,
          lastFailureCode: code,
          updatedAt: now,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: "after" },
    );
    return row ? view(row) : null;
  }
  async expire(job: PrintJobView): Promise<PrintJobView | null> {
    if (!job.leaseUntil || new Date(job.leaseUntil).getTime() > this.now().getTime()) return null;
    return this.fail(job, "ACK_TIMEOUT");
  }
  async acknowledge(input: PrintAck): Promise<PrintJobView> {
    if (
      !validId(input.jobId) ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(input.printerId) ||
      !Number.isSafeInteger(input.attempt) ||
      input.attempt < 1 ||
      !/^[a-f\d-]{36}$/u.test(input.deliveryId) ||
      !["printed", "error"].includes(input.result) ||
      !Number.isFinite(Date.parse(input.at)) ||
      new Date(input.at).toISOString() !== input.at ||
      Math.abs(this.now().getTime() - Date.parse(input.at)) > 300_000
    )
      throw new ApplicationError("VALIDATION", "Invalid print acknowledgement");
    const current = await this.get(input.jobId);
    if (
      !current ||
      current.printerId !== input.printerId ||
      current.attempts !== input.attempt ||
      current.deliveryId !== input.deliveryId
    )
      throw new ApplicationError("CONFLICT", "Stale print acknowledgement");
    if (current.status === "printed" && input.result === "printed") return current;
    const failureCode =
      input.errorCode && /^[A-Z0-9_]{2,40}$/u.test(input.errorCode)
        ? input.errorCode
        : "PRINTER_ERROR";
    if (
      input.result === "error" &&
      ["queued", "dead"].includes(current.status) &&
      current.lastFailureCode === failureCode
    )
      return current;
    if (
      current.status !== "printing" ||
      !current.leaseUntil ||
      new Date(current.leaseUntil).getTime() < this.now().getTime()
    )
      throw new ApplicationError("CONFLICT", "Print attempt is no longer active");
    if (input.result === "error") {
      const failed = await this.fail(current, failureCode);
      if (!failed) throw new ApplicationError("CONFLICT", "Print attempt changed");
      return failed;
    }
    const now = this.now();
    const row = await this.rows().findOneAndUpdate(
      {
        _id: oid(input.jobId),
        status: "printing",
        attempts: input.attempt,
        printerId: input.printerId,
        deliveryId: input.deliveryId,
        leaseUntil: { $gte: now },
      },
      {
        $set: {
          status: "printed",
          printedAt: now,
          acknowledgedAt: new Date(input.at),
          leaseUntil: null,
          nextAttemptAt: null,
          updatedAt: now,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: "after" },
    );
    if (!row) throw new ApplicationError("CONFLICT", "Print attempt changed");
    return view(row);
  }
}
