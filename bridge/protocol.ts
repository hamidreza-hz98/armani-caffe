export type PrintDelivery = Readonly<{
  v: 1;
  type: "print.job";
  jobId: string;
  invoiceId: string;
  printerId: string;
  attempt: number;
  deliveryId: string;
  paperWidthMm: 58 | 80;
  html: string;
}>;

const objectId = /^[a-f\d]{24}$/u;
const uuid = /^[a-f\d-]{36}$/u;
const printer = /^[a-zA-Z0-9_-]{1,64}$/u;

/** The bridge accepts only the fixed server protocol; HTML is never logged. */
export function parsePrintDelivery(raw: string, expectedPrinter: string): PrintDelivery | null {
  if (Buffer.byteLength(raw) > 1_000_000) throw new Error("OVERSIZE_MESSAGE");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const row = value as Record<string, unknown>;
  if (row.v !== 1 || typeof row.type !== "string") throw new Error("UNSUPPORTED_PROTOCOL");
  if (row.type !== "print.job") return null;
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "v",
          "type",
          "jobId",
          "invoiceId",
          "printerId",
          "attempt",
          "deliveryId",
          "paperWidthMm",
          "html",
        ].includes(key),
    ) ||
    typeof row.jobId !== "string" ||
    !objectId.test(row.jobId) ||
    typeof row.invoiceId !== "string" ||
    !objectId.test(row.invoiceId) ||
    typeof row.printerId !== "string" ||
    !printer.test(row.printerId) ||
    row.printerId !== expectedPrinter ||
    !Number.isSafeInteger(row.attempt) ||
    (row.attempt as number) < 1 ||
    typeof row.deliveryId !== "string" ||
    !uuid.test(row.deliveryId) ||
    (row.paperWidthMm !== 58 && row.paperWidthMm !== 80) ||
    typeof row.html !== "string" ||
    !row.html.startsWith('<!doctype html><html lang="fa" dir="rtl">') ||
    !row.html.includes("data:font/woff2;base64,")
  )
    throw new Error("INVALID_PRINT_JOB");
  return row as PrintDelivery;
}

export function printAck(job: PrintDelivery, result: "printed" | "error", errorCode?: string) {
  return {
    v: 1 as const,
    type: "ack" as const,
    jobId: job.jobId,
    printerId: job.printerId,
    attempt: job.attempt,
    deliveryId: job.deliveryId,
    result,
    at: new Date().toISOString(),
    ...(errorCode ? { errorCode } : {}),
  };
}
