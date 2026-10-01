import { type NextRequest, NextResponse } from "next/server";

import { safeDashboardDestination } from "@/dashboard/navigation";
import { adminCookieName, validAdminToken } from "@/modules/auth";

/** The page guard still verifies the server-side session; this only records a safe return path. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const path = request.nextUrl.pathname;
  if (path !== "/dashboard/login") {
    const matches = request.cookies.getAll(adminCookieName(process.env.NODE_ENV === "production"));
    if (matches.length !== 1 || !validAdminToken(matches[0].value)) {
      const url = new URL("/dashboard/login", request.url);
      url.searchParams.set("next", safeDashboardDestination(path));
      const response = NextResponse.redirect(url);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
  }
  headers.set("x-armani-dashboard-path", path);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/dashboard/:path*" };
