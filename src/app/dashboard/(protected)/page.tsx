import type { Metadata } from "next";

import { requireDashboardActor } from "@/dashboard/server";
import styles from "@/dashboard/shell.module.css";

export const metadata: Metadata = { title: "داشبورد" };

export default async function DashboardHome() {
  const actor = await requireDashboardActor();
  return (
    <section className={`${styles.panel} ${styles.placeholder}`}>
      <p>پنل مدیریت / داشبورد</p>
      <h1>خوش آمدید، {actor.displayName}</h1>
      <p>
        از منوی مدیریت برای دسترسی به بخش‌های مجاز استفاده کنید. آمار و صف سفارش‌ها در گام‌های بعدی
        این داشبورد افزوده می‌شوند.
      </p>
    </section>
  );
}
