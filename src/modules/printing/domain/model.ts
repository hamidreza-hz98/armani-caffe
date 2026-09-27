import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

export type PrintJob = EntityDto &
  Readonly<{
    orderId: string;
    printerId: string;
    status: "queued" | "printing" | "printed" | "failed";
    attempts: number;
    nextAttemptAt: UtcTimestamp | null;
    printedAt: UtcTimestamp | null;
    idempotencyKey: string;
  }>;

const allowed: Record<PrintJob["status"], readonly PrintJob["status"][]> = {
  queued: ["printing", "failed"],
  printing: ["printed", "queued", "failed"],
  printed: [],
  failed: ["queued"],
};
export function assertPrintTransition(from: PrintJob["status"], to: PrintJob["status"]): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid print transition: ${from} -> ${to}`);
}
