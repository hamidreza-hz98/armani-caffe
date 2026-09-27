import { NextResponse } from "next/server";

import { checkReadiness } from "@/server/health/readiness";
import { timedRequest } from "@/server/observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { value, requestId } = await timedRequest(request, "health.ready", checkReadiness);
  return NextResponse.json(value, {
    status: value.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
  });
}
