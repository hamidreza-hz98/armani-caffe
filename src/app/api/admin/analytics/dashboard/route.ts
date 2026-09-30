import { handleDashboardAnalyticsHttp } from "@/modules/analytics/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleDashboardAnalyticsHttp(request);
}
