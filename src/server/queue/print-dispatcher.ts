import "server-only";

import { MongoPrintJobs, type PrintJobView } from "../../modules/printing/server.ts";
import { runRecoveringLoop } from "../lifecycle/recovering-loop.ts";
import { logEvent } from "../observability/index.ts";
import type { PrintSchedule } from "./print-redis.ts";

export class PrintDispatcher {
  private readonly jobs: MongoPrintJobs;
  private readonly schedule: PrintSchedule;
  private readonly deliver: (job: PrintJobView) => Promise<boolean>;
  private readonly available: (printerId: string) => boolean;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  constructor(
    jobs: MongoPrintJobs,
    schedule: PrintSchedule,
    deliver: (job: PrintJobView) => Promise<boolean>,
    available: (printerId: string) => boolean,
    now: () => Date = () => new Date(),
    leaseMs = 30_000,
  ) {
    this.jobs = jobs;
    this.schedule = schedule;
    this.deliver = deliver;
    this.available = available;
    this.now = now;
    this.leaseMs = leaseMs;
  }
  /** MongoDB repairs any lost Redis schedule entries after process or Redis restart. */
  async reconcile(): Promise<void> {
    for (const expired of await this.jobs.expired()) {
      const retried = await this.jobs.expire(expired);
      if (retried?.status === "dead")
        logEvent("error", "print.dead_letter", {
          jobId: retried.id,
          attempts: retried.attempts,
          code: "ACK_TIMEOUT",
        });
      if (retried?.status === "queued" && retried.nextAttemptAt)
        await this.schedule.schedule(retried.id, new Date(retried.nextAttemptAt));
    }
    for (const queued of await this.jobs.pending())
      if (queued.nextAttemptAt)
        await this.schedule.schedule(queued.id, new Date(queued.nextAttemptAt));
  }
  async runOnce(): Promise<boolean> {
    await this.reconcile();
    const ids = await this.schedule.due(this.now(), 32);
    let delivered = false;
    for (const id of ids) {
      const current = await this.jobs.get(id);
      if (!current || current.status !== "queued") {
        await this.schedule.remove(id);
        continue;
      }
      if (!this.available(current.printerId)) continue;
      const claim = await this.jobs.claim(id, current.printerId, this.leaseMs);
      if (!claim) continue;
      await this.schedule.remove(id);
      delivered = true;
      try {
        if (!(await this.deliver(claim))) throw new Error("Bridge unavailable");
      } catch (error) {
        const retried = await this.jobs.fail(claim, "DELIVERY_FAILED");
        logEvent(
          retried?.status === "dead" ? "error" : "warn",
          retried?.status === "dead" ? "print.dead_letter" : "print.delivery_failed",
          {
            jobId: claim.id,
            attempts: claim.attempts,
            code: "DELIVERY_FAILED",
            error,
          },
        );
        if (retried?.status === "queued" && retried.nextAttemptAt)
          await this.schedule.schedule(retried.id, new Date(retried.nextAttemptAt));
      }
      // A successful socket send leaves the MongoDB job in printing until its exact ACK arrives.
    }
    return delivered;
  }
  async run(signal: AbortSignal): Promise<void> {
    await runRecoveringLoop(signal, () => this.runOnce(), {
      idleMs: 500,
      activeMs: 500,
      onFailure: (error, attempt, retryMs) =>
        logEvent("error", "print.dispatcher_unavailable", { attempt, retryMs, error }),
      onRecovery: (failures) => logEvent("info", "print.dispatcher_recovered", { failures }),
    });
  }
}
