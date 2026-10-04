import "server-only";

import type { Connection } from "mongoose";

import { runRecoveringLoop } from "../../../server/lifecycle/recovering-loop.ts";
import { logEvent, withRequestContext } from "../../../server/observability/index.ts";
import { retryDelayMs } from "../domain/delivery-policy.ts";
import { type ClaimedOutbox, claimOutbox, failOutbox, finishOutbox } from "./repository.ts";

export type OutboxHandler = (event: ClaimedOutbox, signal: AbortSignal) => Promise<void>;

export class OutboxWorker {
  private readonly connection: Connection;
  private readonly handlers: Readonly<Record<string, OutboxHandler>>;
  private readonly options: Readonly<{
    workerId: string;
    now?: () => Date;
    random?: () => number;
    leaseMs?: number;
    handlerTimeoutMs?: number;
    pollMs?: number;
  }>;

  constructor(
    connection: Connection,
    handlers: Readonly<Record<string, OutboxHandler>>,
    options: OutboxWorker["options"],
  ) {
    this.connection = connection;
    this.handlers = handlers;
    this.options = options;
    const lease = options.leaseMs ?? 30_000;
    const timeout = options.handlerTimeoutMs ?? 20_000;
    if (lease < 1000 || timeout >= lease || timeout < 100) {
      throw new RangeError("Handler timeout must be shorter than the lease");
    }
  }

  async runOnce(): Promise<boolean> {
    const now = this.options.now ?? (() => new Date());
    const eventTypes = Object.keys(this.handlers);
    const claim = await claimOutbox(
      this.connection,
      this.options.workerId,
      now(),
      this.options.leaseMs ?? 30_000,
      eventTypes,
    );
    if (!claim) return false;
    return withRequestContext(claim.requestId, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.handlerTimeoutMs ?? 20_000);
      try {
        const handler = this.handlers[claim.eventType];
        if (!handler) throw new Error("No outbox handler registered");
        await Promise.race([
          handler(claim, controller.signal),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("Outbox handler timed out")),
              { once: true },
            ),
          ),
        ]);
        const finished = await finishOutbox(this.connection, claim, now());
        if (!finished)
          logEvent("warn", "outbox.lease_lost", {
            eventId: claim.id,
            workerId: this.options.workerId,
          });
        else
          logEvent("info", "outbox.delivered", {
            eventId: claim.id,
            eventType: claim.eventType,
            attempt: claim.attempts,
          });
      } catch (error) {
        const code = controller.signal.aborted
          ? "HANDLER_TIMEOUT"
          : this.handlers[claim.eventType]
            ? "HANDLER_FAILED"
            : "NO_HANDLER";
        const backoff = retryDelayMs(claim.attempts, this.options.random);
        const updated = await failOutbox(this.connection, claim, now(), code, backoff);
        const dead = claim.attempts >= claim.maxAttempts;
        logEvent(
          !updated || dead ? "error" : "warn",
          !updated ? "outbox.lease_lost" : dead ? "outbox.dead_letter" : "outbox.delivery_failed",
          {
            eventId: claim.id,
            eventType: claim.eventType,
            attempt: claim.attempts,
            dead,
            code,
            error,
          },
        );
      } finally {
        clearTimeout(timeout);
      }
      return true;
    });
  }

  async run(signal: AbortSignal): Promise<void> {
    await runRecoveringLoop(signal, () => this.runOnce(), {
      idleMs: this.options.pollMs ?? 1000,
      random: this.options.random,
      onFailure: (error, attempt, retryMs) =>
        logEvent("error", "outbox.worker_unavailable", {
          workerId: this.options.workerId,
          attempt,
          retryMs,
          error,
        }),
      onRecovery: (failures) =>
        logEvent("info", "outbox.worker_recovered", {
          workerId: this.options.workerId,
          failures,
        }),
    });
  }
}
