import { ApplicationError } from "../../../shared/errors.ts";
import type { OrderStatus } from "../domain/model.ts";
const invalid = () => new ApplicationError("VALIDATION", "Invalid order command");
export function orderId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/u.test(value)) throw invalid();
  return value;
}
export function commandRecord(value: unknown, fields: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw invalid();
  return value as Record<string, unknown>;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
}
export function checkoutCommand(value: unknown) {
  const v = commandRecord(value, ["cartId", "revision", "idempotencyKey"]);
  if (typeof v.idempotencyKey !== "string" || !/^[A-Za-z\d_-]{8,100}$/u.test(v.idempotencyKey))
    throw invalid();
  return {
    cartId: orderId(v.cartId),
    revision: revision(v.revision),
    idempotencyKey: v.idempotencyKey,
  };
}
export function transitionCommand(value: unknown) {
  const v = commandRecord(value, ["revision", "status", "reason"]);
  if (!["PREPARING", "READY", "COMPLETED", "CANCELLED"].includes(v.status as string))
    throw invalid();
  const reason = v.reason === undefined ? "" : v.reason;
  if (
    typeof reason !== "string" ||
    reason.length > 1000 ||
    /[\u0000-\u001f\u007f]/u.test(reason) ||
    (v.status === "CANCELLED" && !reason.trim())
  )
    throw invalid();
  return { revision: revision(v.revision), status: v.status as OrderStatus, reason: reason.trim() };
}
export function refundCommand(value: unknown) {
  const v = commandRecord(value, ["revision", "reason"]);
  if (
    typeof v.reason !== "string" ||
    !v.reason.trim() ||
    v.reason.length > 1000 ||
    /[\u0000-\u001f\u007f]/u.test(v.reason)
  )
    throw invalid();
  return { revision: revision(v.revision), reason: v.reason.trim() };
}
