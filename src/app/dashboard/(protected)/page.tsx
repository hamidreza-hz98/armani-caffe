import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { linksForRole } from "@/dashboard/navigation";
import {
  AttentionWidget,
  CustomersWidget,
  LatestOrdersWidget,
  MetricsWidget,
  ProductsWidget,
  Shortcuts,
  StockWidget,
  TrendWidget,
  WidgetSkeleton,
} from "@/dashboard/overview";
import styles from "@/dashboard/overview.module.css";
import { dashboardOverviewWidgets, requireDashboardActor } from "@/dashboard/server";
import type { OverviewRange } from "@/modules/analytics";
import { requireAdminCapability } from "@/shared/admin-capabilities";

export const metadata: Metadata = { title: "نمای کلی داشبورد" };

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const actor = await requireDashboardActor();
  const range: OverviewRange = (await searchParams).range === "7" ? 7 : 30;
  requireAdminCapability(actor, "orders.read");
  requireAdminCapability(actor, "inventory.read");
  const widgets = dashboardOverviewWidgets();
  const attention = widgets.then((reader) => reader.attention());
  const stock = widgets.then((reader) => reader.lowStock());
  const orders = widgets.then((reader) => reader.latestOrders());
  const owner = actor.role === "OWNER";
  const sales = owner ? widgets.then((reader) => reader.sales(range)) : null;
  const trend = owner ? widgets.then((reader) => reader.trend(range)) : null;
  const products = owner ? widgets.then((reader) => reader.bestProducts()) : null;
  const customers = owner ? widgets.then((reader) => reader.bestCustomers()) : null;
  const retryUrl = `/dashboard?range=${range}`;

  return (
    <div className={styles.overview}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>آرمانی کافه / مدیریت</p>
          <h1>نمای کلی</h1>
          <p>خوش آمدید، {actor.displayName}. وضعیت کافه را یک‌جا ببینید.</p>
        </div>
        {owner && (
          <nav className={styles.ranges} aria-label="بازه گزارش فروش">
            <Link href="/dashboard?range=7" aria-current={range === 7 ? "page" : undefined}>
              ۷ روز
            </Link>
            <Link href="/dashboard?range=30" aria-current={range === 30 ? "page" : undefined}>
              ۳۰ روز
            </Link>
          </nav>
        )}
      </header>

      <section aria-label="نیازمند اقدام">
        <h2 className={styles.sectionTitle}>نیازمند اقدام</h2>
        <div className={styles.attentionGrid}>
          <Suspense fallback={<WidgetSkeleton title="سفارش‌های باز" />}>
            <AttentionWidget data={attention} retryUrl={retryUrl} />
          </Suspense>
          <Suspense fallback={<WidgetSkeleton title="موجودی کم" />}>
            <StockWidget data={stock} retryUrl={retryUrl} compact />
          </Suspense>
        </div>
      </section>

      {owner && sales && trend && products && customers && (
        <>
          <section aria-label="آمار فروش">
            <h2 className={styles.sectionTitle}>فروش و سفارش‌ها</h2>
            <Suspense fallback={<WidgetSkeleton title="شاخص‌های فروش" />}>
              <MetricsWidget data={sales} range={range} retryUrl={retryUrl} />
            </Suspense>
          </section>
          <Suspense fallback={<WidgetSkeleton title="روند فروش" />}>
            <TrendWidget data={trend} range={range} retryUrl={retryUrl} />
          </Suspense>
        </>
      )}

      <div className={styles.twoColumns}>
        <Suspense fallback={<WidgetSkeleton title="آخرین سفارش‌ها" />}>
          <LatestOrdersWidget data={orders} retryUrl={retryUrl} />
        </Suspense>
        <Suspense fallback={<WidgetSkeleton title="اقلام کم‌موجودی" />}>
          <StockWidget data={stock} retryUrl={retryUrl} />
        </Suspense>
      </div>

      {owner && products && customers && (
        <div className={styles.twoColumns}>
          <Suspense fallback={<WidgetSkeleton title="محصولات پرفروش" />}>
            <ProductsWidget data={products} retryUrl={retryUrl} />
          </Suspense>
          <Suspense fallback={<WidgetSkeleton title="مشتریان برتر" />}>
            <CustomersWidget data={customers} retryUrl={retryUrl} />
          </Suspense>
        </div>
      )}
      <Shortcuts links={linksForRole(actor.role)} />
    </div>
  );
}
