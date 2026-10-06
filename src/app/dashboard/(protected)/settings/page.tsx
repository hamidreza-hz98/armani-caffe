import type { Metadata } from "next";
import Link from "next/link";

import { DashboardIcon } from "@/dashboard/icon";
import { requireDashboardActor } from "@/dashboard/server";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

import styles from "./settings.module.css";

export const metadata: Metadata = { title: "تنظیمات", robots: { index: false, follow: false } };

const sections = [
  {
    href: "/dashboard/settings/business",
    icon: "store",
    title: "هویت کسب‌وکار و رسانه‌ها",
    excerpt: "نام، نشان تجاری، لوگو و تصاویر اصلی کافه را مدیریت کنید.",
  },
  {
    href: "/dashboard/settings/contact",
    icon: "phone",
    title: "راه‌های ارتباطی",
    excerpt: "شماره تماس، شبکه‌های اجتماعی و نشانی روی نقشه را ویرایش کنید.",
  },
  {
    href: "/dashboard/settings/seo",
    icon: "search",
    title: "بهینه‌سازی جستجو",
    excerpt: "عنوان‌ها و توضیحات پیش‌فرض صفحات عمومی را تنظیم کنید.",
  },
  {
    href: "/dashboard/settings/printing",
    icon: "printer",
    title: "چاپ و صندوق",
    excerpt: "چاپ سفارش‌ها و اتصال چاپگر صندوق را پیکربندی کنید.",
  },
  {
    href: "/dashboard/settings/payment",
    icon: "creditCard",
    title: "درگاه‌های پرداخت",
    excerpt: "روش پرداخت آنلاین و تنظیمات درگاه را مدیریت کنید.",
  },
] as const;

export default async function SettingsPage() {
  const actor = await requireDashboardActor();
  const canManage = adminCapabilityMap[actor.role].includes("settings.manage");

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>مدیریت کافه</span>
        <h1>تنظیمات سیستم</h1>
        <p>اطلاعات برند و ابزارهای اصلی کسب‌وکار را از یکجا مدیریت کنید.</p>
      </header>
      {canManage ? (
        <nav className={styles.grid} aria-label="بخش‌های تنظیمات">
          {sections.map((section) => (
            <Link className={styles.card} href={section.href} key={section.href}>
              <span className={styles.icon}>
                <DashboardIcon name={section.icon} />
              </span>
              <span className={styles.content}>
                <strong>{section.title}</strong>
                <span>{section.excerpt}</span>
              </span>
              <span className={styles.arrow} aria-hidden="true">
                <DashboardIcon name="chevron" />
              </span>
            </Link>
          ))}
        </nav>
      ) : (
        <p className={styles.notice}>مدیریت این تنظیمات فقط برای مالک کافه در دسترس است.</p>
      )}
    </main>
  );
}
