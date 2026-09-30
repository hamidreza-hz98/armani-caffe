import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

export type PrintJob = EntityDto &
  Readonly<{
    orderId: string;
    printerId: string;
    status: "queued" | "printing" | "printed" | "dead";
    attempts: number;
    nextAttemptAt: UtcTimestamp | null;
    printedAt: UtcTimestamp | null;
    idempotencyKey: string;
  }>;

const allowed: Record<PrintJob["status"], readonly PrintJob["status"][]> = {
  queued: ["printing", "dead"],
  printing: ["printed", "queued", "dead"],
  printed: [],
  dead: [],
};
export function assertPrintTransition(from: PrintJob["status"], to: PrintJob["status"]): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid print transition: ${from} -> ${to}`);
}
