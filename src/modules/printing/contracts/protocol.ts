import { ApplicationError } from "../../../shared/errors.ts";

export const printProtocolVersion = 1 as const;
export type BridgeMessage =
  | { v: 1; type: "register"; printerId: string; token: string; instanceId: string }
  | { v: 1; type: "heartbeat"; at: string }
  | {
      v: 1;
      type: "ack";
      jobId: string;
      printerId: string;
      attempt: number;
      deliveryId: string;
      result: "printed" | "error";
      at: string;
      errorCode?: string;
    };

export function parseBridgeMessage(raw: string): BridgeMessage {
  if (new TextEncoder().encode(raw).byteLength > 8192)
    throw new ApplicationError("VALIDATION", "Realtime message too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApplicationError("VALIDATION", "Invalid realtime JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError("VALIDATION", "Invalid realtime message");
  const row = value as Record<string, unknown>;
  if (row.v !== 1 || typeof row.type !== "string")
    throw new ApplicationError("VALIDATION", "Unsupported realtime protocol");
  const keys = (allowed: string[]) => {
    if (Object.keys(row).some((key) => !allowed.includes(key)))
      throw new ApplicationError("VALIDATION", "Unknown realtime field");
  };
  const text = (item: unknown, pattern: RegExp) => typeof item === "string" && pattern.test(item);
  const id = /^[a-f\d]{24}$/u,
    printer = /^[a-zA-Z0-9_-]{1,64}$/u;
  if (row.type === "register") {
    keys(["v", "type", "printerId", "token", "instanceId"]);
    if (
      !text(row.printerId, printer) ||
      !text(row.token, /^.{32,512}$/u) ||
      !text(row.instanceId, /^[a-zA-Z0-9_-]{8,80}$/u)
    )
      throw new ApplicationError("VALIDATION", "Invalid bridge registration");
    return row as BridgeMessage;
  }
  if (row.type === "heartbeat") {
    keys(["v", "type", "at"]);
    if (
      !text(row.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u) ||
      !Number.isFinite(Date.parse(row.at as string))
    )
      throw new ApplicationError("VALIDATION", "Invalid heartbeat");
    return row as BridgeMessage;
  }
  if (row.type === "ack") {
    keys(["v", "type", "jobId", "printerId", "attempt", "deliveryId", "result", "at", "errorCode"]);
    if (
      !text(row.jobId, id) ||
      !text(row.printerId, printer) ||
      !Number.isSafeInteger(row.attempt) ||
      (row.attempt as number) < 1 ||
      !text(row.deliveryId, /^[a-f\d-]{36}$/u) ||
      !["printed", "error"].includes(row.result as string) ||
      !text(row.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u) ||
      (row.errorCode !== undefined && !text(row.errorCode, /^[A-Z0-9_]{2,40}$/u))
    )
      throw new ApplicationError("VALIDATION", "Invalid print ACK");
    return row as BridgeMessage;
  }
  throw new ApplicationError("VALIDATION", "Unknown realtime message type");
}
