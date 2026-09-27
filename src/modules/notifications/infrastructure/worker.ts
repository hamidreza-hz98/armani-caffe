import "server-only";

import { setTimeout as delay } from "node:timers/promises";

import type { Connection } from "mongoose";

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
        logEvent(
          updated ? "warn" : "error",
          updated ? "outbox.delivery_failed" : "outbox.lease_lost",
          {
            eventId: claim.id,
            eventType: claim.eventType,
            attempt: claim.attempts,
            dead: claim.attempts >= claim.maxAttempts,
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
    const pollMs = this.options.pollMs ?? 1000;
    while (!signal.aborted) {
      const found = await this.runOnce();
      if (!found) {
        try {
          await delay(pollMs, undefined, { signal });
        } catch {
          break;
        }
      }
    }
  }
}
