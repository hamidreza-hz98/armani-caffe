import "server-only";

import { randomUUID } from "node:crypto";

import { type SafeError, serializeError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { logEvent, withRequestContext } from "./observability/index.ts";

/** Wrap server actions after authentication, authorization, and input validation. */
export async function runSafeAction<T>(
  name: string,
  action: () => Promise<T>,
  requestId = randomUUID(),
): Promise<Result<T, SafeError>> {
  return withRequestContext(requestId, async () => {
    try {
      return ok(await action());
    } catch (error) {
      logEvent("error", "action.failed", { action: name, error });
      return err(serializeError(error, requestId));
    }
  });
}
