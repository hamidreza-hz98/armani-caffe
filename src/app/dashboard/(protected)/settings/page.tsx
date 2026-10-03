import type { Metadata } from "next";
import Link from "next/link";

import { requireDashboardActor } from "@/dashboard/server";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

export const metadata: Metadata = { title: "تنظیمات", robots: { index: false, follow: false } };
export default async function SettingsPage() {
  const actor = await requireDashboardActor();
  return (
    <section style={{ padding: 24 }}>
      <h1>تنظیمات سیستم</h1>
      <p>تنظیمات کسب‌وکار و اطلاعات حساس فقط برای مالک در دسترس است.</p>
      {adminCapabilityMap[actor.role].includes("settings.manage") && (
        <nav aria-label="بخش‌های تنظیمات" style={{ display: "grid", gap: 16 }}>
          <Link href="/dashboard/settings/business">هویت کسب‌وکار و رسانه‌ها</Link>
          <Link href="/dashboard/settings/contact">تماس، شبکه‌های اجتماعی و نقشه</Link>
          <Link href="/dashboard/settings/seo">پیش‌فرض‌های سئو</Link>
          <Link href="/dashboard/settings/printing">چاپ و چاپ آزمایشی</Link>
          <Link href="/dashboard/settings/payment">درگاه‌های پرداخت</Link>
        </nav>
      )}
    </section>
  );
}
