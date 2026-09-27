import "server-only";

import { ApplicationError } from "../../shared/errors.ts";

export function mapDuplicateKey(error: unknown): ApplicationError | null {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 11000) {
    return null;
  }
  const fields =
    "keyPattern" in error && typeof error.keyPattern === "object" && error.keyPattern
      ? Object.keys(error.keyPattern)
      : [];
  const label = fields.length ? fields.join(", ") : "unique field";
  return new ApplicationError("CONFLICT", `Duplicate value for ${label}`);
}
