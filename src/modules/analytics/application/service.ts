import type { AdminAuthorizer } from "../../../shared/security-ports.ts";
import type { DashboardAnalytics } from "../contracts/dashboard.ts";

export interface DashboardReadModel {
  read(): Promise<DashboardAnalytics>;
}
export class DashboardAnalyticsService {
  constructor(
    private readonly model: DashboardReadModel,
    private readonly authorize: AdminAuthorizer,
  ) {}
  async read(token: string | null): Promise<DashboardAnalytics> {
    await this.authorize(token, "analytics.read");
    return this.model.read();
  }
}
