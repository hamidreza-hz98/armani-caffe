import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import {
  requireSettingsActor,
  requireSettingsOwner,
  type SettingsService,
} from "../application/service.ts";
import { parseSettingsWrite, settingsKind, settingsMutationKey } from "../contracts/settings.ts";
import type { SettingsActor } from "../domain/model.ts";

async function jsonBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
    !request.body
  )
    throw new ApplicationError("VALIDATION", "JSON required");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > 16 * 1024) {
        await reader.cancel();
        throw new ApplicationError("VALIDATION", "Settings body too large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError("VALIDATION", "Invalid JSON");
  }
}
export function createSettingsHttpHandler(options: {
  service: () => Promise<SettingsService>;
  authenticate: (request: Request) => Promise<SettingsActor | null>;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: "public" | "read" | "update", kindInput?: string) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      `settings.${operation}`,
      async () => {
        const expectedMethod = operation === "update" ? "PATCH" : "GET";
        if (request.method !== expectedMethod || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Unexpected settings request");
        if (operation === "public") return (await options.service()).publicSettings();
        const actor = await options.authenticate(request);
        if (operation === "update") requireSettingsOwner(actor);
        else requireSettingsActor(actor);
        const kind = settingsKind(kindInput);
        if (operation === "read") return (await options.service()).read(actor, kind);
        if (!options.origins().includes(request.headers.get("origin") ?? ""))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const key = settingsMutationKey(request.headers.get("idempotency-key"));
        const input = parseSettingsWrite(kind, await jsonBody(request));
        return (await options.service()).update(actor, kind, key, input, requestId);
      },
      requestId,
    );
    return Response.json(result, {
      status: result.ok ? 200 : errorStatus(result.error.code),
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
