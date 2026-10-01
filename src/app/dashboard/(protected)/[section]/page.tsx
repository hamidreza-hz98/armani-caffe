import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";

import { dashboardSection } from "@/dashboard/navigation";
import { requireDashboardActor, searchDashboardOrder } from "@/dashboard/server";
import styles from "@/dashboard/shell.module.css";
import { adminCapabilityMap } from "@/shared/admin-capabilities";
import { formatJalaliDate, formatToman } from "@/theme/format";

export const metadata: Metadata = { title: "بخش مدیریت" };
const orderStatusLabels: Record<string, string> = {
  NEW: "ثبت‌شده",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده دریافت",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

export default async function DashboardSection({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { section } = await params;
  const link = dashboardSection(section);
  if (!link) notFound();
  const actor = await requireDashboardActor();
  if (!adminCapabilityMap[actor.role].includes(link.capability)) forbidden();
  const query = section === "orders" ? (await searchParams).q?.trim().slice(0, 80) : null;
  const result = query ? await searchDashboardOrder(query) : null;
  return (
    <section className={`${styles.panel} ${styles.placeholder}`}>
      <p>پنل مدیریت / {link.label}</p>
      <h1>{link.label}</h1>
      {query ? (
        result ? (
          <div role="status">
            <p>نتیجه جستجوی سفارش</p>
            <dl>
              <div>
                <dt>شماره سفارش</dt>
                <dd>
                  <bdi dir="ltr">{result.code}</bdi>
                </dd>
              </div>
              <div>
                <dt>وضعیت</dt>
                <dd>{orderStatusLabels[result.status] ?? "در حال بررسی"}</dd>
              </div>
              <div>
                <dt>مبلغ</dt>
                <dd>{formatToman(result.totalToman)}</dd>
              </div>
              <div>
                <dt>زمان ثبت</dt>
                <dd>{formatJalaliDate(result.placedAt, true)}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p role="status">
            سفارشی با این شماره پیدا نشد. جستجو با شماره‌ای مانند AC-0008932 انجام می‌شود.
          </p>
        )
      ) : (
        <p>
          پوسته این بخش آماده است. داده‌ها و عملیات تخصصی آن در تسک مربوط به همین بخش اضافه می‌شوند.
        </p>
      )}
      <Link href="/dashboard">بازگشت به داشبورد</Link>
    </section>
  );
}
