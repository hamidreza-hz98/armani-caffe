import { NextResponse } from "next/server";

import { timedRequest } from "@/server/observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { requestId } = await timedRequest(request, "health.live", async () => true);
  return NextResponse.json(
    { status: "alive" },
    { headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } },
  );
}
