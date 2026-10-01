import "server-only";

import { getDatabaseConnection } from "../../server/database/connection.ts";
import { adminTokenFromRequest, configuredAdminSecurity } from "../auth/server.ts";
import { DashboardAnalyticsService } from "./application/service.ts";
import { createDashboardAnalyticsHttp } from "./infrastructure/http.ts";
import { MongoDashboardAnalytics } from "./infrastructure/repository.ts";

export { DashboardAnalyticsService } from "./application/service.ts";
export { createDashboardAnalyticsHttp } from "./infrastructure/http.ts";
export { MongoOverviewWidgets } from "./infrastructure/overview-widgets.ts";
export { MongoDashboardAnalytics } from "./infrastructure/repository.ts";
export async function configuredDashboardAnalytics() {
  return new DashboardAnalyticsService(
    new MongoDashboardAnalytics(await getDatabaseConnection()),
    async (token, capability) =>
      (await configuredAdminSecurity()).store.authorize(token, capability),
  );
}
export const handleDashboardAnalyticsHttp = createDashboardAnalyticsHttp({
  service: configuredDashboardAnalytics,
  token: adminTokenFromRequest,
});
