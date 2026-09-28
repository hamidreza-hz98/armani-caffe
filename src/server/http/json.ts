import "server-only";

import { ApplicationError } from "../../shared/errors.ts";

export async function readJsonBody(request: Request, limit = 16 * 1024): Promise<unknown> {
  if (
    !request.body ||
    request.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    throw new ApplicationError("VALIDATION", "JSON required");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new ApplicationError("VALIDATION", "JSON body too large");
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
