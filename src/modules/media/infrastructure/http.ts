import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import { MediaService, requireMediaOwner } from "../application/service.ts";
import {
  idempotencyKey,
  type MediaActor,
  mediaId,
  parseInitiation,
  parseMediaList,
  parseMetadata,
  record,
} from "../contracts/media.ts";

export type MediaOperation =
  | "list"
  | "detail"
  | "file"
  | "initiate"
  | "initiateBulk"
  | "complete"
  | "completeBulk"
  | "update"
  | "delete"
  | "replace"
  | "usages";
export type MediaAuthenticator = (request: Request) => Promise<MediaActor | null>;
async function body(request: Request): Promise<unknown> {
  if (!request.body) return {};
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new ApplicationError("VALIDATION", "JSON is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new ApplicationError("VALIDATION", "JSON body is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError("VALIDATION", "Malformed JSON");
  }
}
export function createMediaHttpHandler(options: {
  service: () => Promise<MediaService>;
  authenticate: MediaAuthenticator;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: MediaOperation, id?: string): Promise<Response> => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const headers = {
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
      "X-Content-Type-Options": "nosniff",
    };
    const result = await runSafeAction(
      `media.${operation}`,
      async () => {
        const actor = await options.authenticate(request);
        const mutation = !["list", "detail", "file", "usages"].includes(operation);
        if (mutation || operation === "usages") requireMediaOwner(actor);
        if (mutation && !options.origins().includes(request.headers.get("origin") ?? ""))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const url = new URL(request.url);
        if (["initiate", "initiateBulk", "update", "delete", "replace"].includes(operation))
          idempotencyKey(request.headers.get("idempotency-key"));
        if (id !== undefined) mediaId(id);
        let value: unknown = {};
        if (mutation) value = await body(request);
        if (operation === "initiate") value = parseInitiation(value);
        else if (operation === "initiateBulk") record(value, ["items"]);
        else if (operation === "completeBulk") record(value, ["ids"]);
        else if (operation === "update") {
          const payload = record(value, ["revision", "metadata"]);
          parseMetadata(payload.metadata);
          if (!Number.isSafeInteger(payload.revision) || (payload.revision as number) < 0)
            throw new ApplicationError("VALIDATION", "Revision is required");
        } else if (operation === "replace") mediaId(record(value, ["targetId"]).targetId);
        else if (mutation) record(value, []);
        if (operation === "list") parseMediaList(url.searchParams);
        else if (operation === "file") {
          if (
            [...url.searchParams.keys()].some((key) => key !== "variant") ||
            url.searchParams.getAll("variant").length > 1 ||
            !["original", "small", "large"].includes(url.searchParams.get("variant") ?? "original")
          )
            throw new ApplicationError("VALIDATION", "Invalid variant query");
        } else if (url.search)
          throw new ApplicationError("VALIDATION", "Unexpected query parameters");
        const service = await options.service();
        const key = request.headers.get("idempotency-key");
        if (operation === "list") return service.list(actor, url.searchParams);
        if (operation === "detail") return service.detail(actor, id);
        if (operation === "usages") return service.usages(actor, id);
        if (operation === "initiate") return service.initiate(actor, key, value);
        if (operation === "initiateBulk")
          return service.initiateBulk(actor, key, (value as { items: unknown }).items);
        if (operation === "complete") return service.complete(actor, id);
        if (operation === "completeBulk")
          return service.completeBulk(actor, (value as { ids: unknown }).ids);
        if (operation === "update") {
          const payload = value as { revision: unknown; metadata: unknown };
          return service.update(actor, id, key, payload.revision, payload.metadata);
        }
        if (operation === "delete") return service.delete(actor, id, key);
        if (operation === "replace")
          return service.replace(actor, id, (value as { targetId: unknown }).targetId, key);
        const file = await service.readFile(
          actor,
          id,
          url.searchParams.get("variant") ?? "original",
          request.headers.get("if-none-match") ?? undefined,
        );
        const etag = `"${file.etag}"`;
        return new Response(file.notModified ? null : new Uint8Array(file.bytes), {
          status: file.notModified ? 304 : 200,
          headers: {
            ...headers,
            "Cache-Control":
              file.visibility === "public" ? "public, max-age=60" : "private, no-store",
            "Content-Type": "image/webp",
            ETag: etag,
          },
        });
      },
      requestId,
    );
    if (!result.ok)
      return Response.json(result, { status: errorStatus(result.error.code), headers });
    if (result.value instanceof Response) return result.value;
    return Response.json(result, { headers });
  };
}
