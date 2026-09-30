import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

import { OutputUncertainError, type PrinterAdapter } from "./adapters.ts";
import { type JournalEntry, PrintJournal } from "./journal.ts";
import { parsePrintDelivery, printAck, type PrintDelivery } from "./protocol.ts";

export type BridgeConfig = Readonly<{
  url: string;
  printerId: string;
  token: string;
  journalDirectory: string;
}>;
type Log = (event: string, fields?: Record<string, string | number | boolean>) => void;
const safeCode = (error: unknown) => {
  const code = error instanceof Error ? error.message : "PRINTER_ERROR";
  return /^[A-Z0-9_]{2,40}$/u.test(code) ? code : "PRINTER_ERROR";
};

export class PrintBridge {
  private readonly config: BridgeConfig;
  private readonly adapter: PrinterAdapter;
  private readonly render: (job: PrintDelivery) => Promise<Uint8Array>;
  private readonly log: Log;
  readonly journal: PrintJournal;
  private readonly instanceId = randomUUID().replaceAll("-", "");
  private socket?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private working = Promise.resolve();
  private currentJob: string | null = null;
  private connected = false;
  constructor(
    config: BridgeConfig,
    adapter: PrinterAdapter,
    render: (job: PrintDelivery) => Promise<Uint8Array>,
    log: Log,
  ) {
    this.config = config;
    this.adapter = adapter;
    this.render = render;
    this.log = log;
    this.journal = new PrintJournal(config.journalDirectory);
  }
  status() {
    return { connected: this.connected, currentJob: this.currentJob };
  }
  private send(value: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(value));
    return true;
  }
  private async record(job: PrintDelivery, state: JournalEntry["state"], errorCode?: string) {
    await this.journal.write({
      jobId: job.jobId,
      invoiceId: job.invoiceId,
      attempt: job.attempt,
      deliveryId: job.deliveryId,
      state,
      updatedAt: new Date().toISOString(),
      ...(errorCode ? { errorCode } : {}),
    });
  }
  async handle(job: PrintDelivery): Promise<void> {
    const existing = await this.journal.read(job.jobId);
    if (existing && existing.invoiceId !== job.invoiceId)
      throw new Error("JOURNAL_IDENTITY_MISMATCH");
    if (existing?.state === "printed" || existing?.state === "acknowledged") {
      this.log("duplicate_print_suppressed", { jobId: job.jobId, attempt: job.attempt });
      this.send(printAck(job, "printed"));
      return;
    }
    if (existing?.state === "received") {
      // A crash may have occurred after physical output but before the journal's success write.
      // Never make an unattended second physical copy in this ambiguous state.
      this.log("manual_reconciliation_required", { jobId: job.jobId });
      return;
    }
    this.currentJob = job.jobId;
    await this.record(job, "received");
    try {
      try {
        const bytes = await this.render(job);
        await this.adapter.print(bytes, job);
      } catch (error) {
        if (error instanceof OutputUncertainError) {
          this.log("manual_reconciliation_required", { jobId: job.jobId });
          return;
        }
        const errorCode = safeCode(error);
        await this.record(job, "failed", errorCode);
        this.log("print_failed", { jobId: job.jobId, attempt: job.attempt, errorCode });
        this.send(printAck(job, "error", errorCode));
        return;
      }
      // A journal write failure after adapter acceptance is ambiguous: leave "received"
      // for operator review instead of recording a retryable printer failure.
      await this.record(job, "printed");
      this.log("print_accepted", { jobId: job.jobId, attempt: job.attempt });
      this.send(printAck(job, "printed"));
    } finally {
      this.currentJob = null;
    }
  }
  private async connectOnce(signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const socket = new WebSocket(this.config.url, {
        handshakeTimeout: 10_000,
        maxPayload: 1_000_000,
        perMessageDeflate: false,
      });
      this.socket = socket;
      let opened = false;
      let registered = false;
      socket.once("open", () => {
        opened = true;
        this.send({
          v: 1,
          type: "register",
          printerId: this.config.printerId,
          token: this.config.token,
          instanceId: this.instanceId,
        });
      });
      socket.on("message", (data) => {
        try {
          const raw = data.toString();
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") throw new Error("INVALID_SERVER_MESSAGE");
          const message = parsed as Record<string, unknown>;
          if (message.v !== 1) throw new Error("UNSUPPORTED_PROTOCOL");
          if (message.type === "registered") {
            if (
              message.printerId !== this.config.printerId ||
              !Number.isSafeInteger(message.heartbeatMs)
            )
              throw new Error("INVALID_REGISTRATION");
            this.connected = true;
            registered = true;
            this.log("registered", { printerId: this.config.printerId });
            this.heartbeat = setInterval(
              () => this.send({ v: 1, type: "heartbeat", at: new Date().toISOString() }),
              Math.max(1000, (message.heartbeatMs as number) / 2),
            );
            return;
          }
          if (message.type === "ack.accepted") {
            if (typeof message.jobId === "string" && message.status === "printed") {
              this.working = this.working.then(async () => {
                const entry = await this.journal.read(message.jobId as string);
                if (entry?.state === "printed")
                  await this.journal.write({
                    ...entry,
                    state: "acknowledged",
                    updatedAt: new Date().toISOString(),
                  });
              });
            }
            return;
          }
          if (message.type === "heartbeat.ack") return;
          if (!this.connected) throw new Error("UNREGISTERED_MESSAGE");
          const job = parsePrintDelivery(raw, this.config.printerId);
          if (!job) throw new Error("UNKNOWN_SERVER_MESSAGE");
          this.working = this.working
            .then(() => this.handle(job))
            .catch((error: unknown) => {
              this.log("job_handler_error", { jobId: job.jobId, errorCode: safeCode(error) });
            });
        } catch (error) {
          this.log("protocol_error", { errorCode: safeCode(error) });
          socket.close(1008, "Protocol error");
        }
      });
      socket.once("error", (error) => {
        if (!opened) reject(error);
        else this.log("socket_error", { errorCode: safeCode(error) });
      });
      socket.once("close", () => {
        this.connected = false;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        resolve(registered);
      });
      signal.addEventListener("abort", () => socket.close(), { once: true });
    });
  }
  async run(signal: AbortSignal): Promise<void> {
    await this.journal.lock();
    let retry = 0;
    try {
      while (!signal.aborted) {
        try {
          if (await this.connectOnce(signal)) retry = 0;
        } catch (error) {
          this.log("connection_failed", { errorCode: safeCode(error) });
        }
        if (signal.aborted) break;
        const backoff = Math.min(30_000, 1000 * 2 ** Math.min(retry++, 5));
        this.log("reconnecting", { inMs: backoff });
        try {
          await delay(backoff + Math.round(Math.random() * 500), undefined, { signal });
        } catch {
          break;
        }
      }
      await this.working;
    } finally {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.socket?.close();
      await this.journal.unlock();
    }
  }
}
