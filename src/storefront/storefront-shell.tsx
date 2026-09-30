import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatPersianNumber } from "@/theme/format";

import { ContactSheet } from "./contact-sheet";
import type { StorefrontShellData } from "./data";
import { StorefrontIcon } from "./icons";
import styles from "./storefront.module.css";

export function StorefrontShell({
  data,
  children,
}: {
  data: StorefrontShellData;
  children: ReactNode;
}) {
  const accountLabel =
    data.account.state === "customer"
      ? data.account.name || "حساب من"
      : data.account.state === "guest"
        ? "ورود"
        : "حساب نامشخص";
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#storefront-content">
        رفتن به محتوای اصلی
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="صفحه اصلی کافه آرمانی">
            <Image src="/icon.svg" alt="" width={42} height={42} priority />
            <span>
              <strong>{data.businessName}</strong>
              <small>کافه و سفارش آنلاین</small>
            </span>
          </Link>
          <nav className={styles.actions} aria-label="ابزارهای فروشگاه">
            <ContactSheet links={data.contacts} address={data.contactAddress} />
            <Link
              className={styles.iconLink}
              href="/account"
              aria-label={data.account.state === "customer" ? `حساب ${accountLabel}` : accountLabel}
              title={accountLabel}
            >
              <StorefrontIcon name="user" />
              <span className={styles.accountText}>{accountLabel}</span>
            </Link>
            <Link
              className={styles.iconLink}
              href="/cart"
              aria-label={
                data.cartCount === null
                  ? "سبد خرید، شمارش نامشخص"
                  : `سبد خرید، ${formatPersianNumber(data.cartCount)} کالا`
              }
              title="سبد خرید"
            >
              <StorefrontIcon name="cart" />
              {data.cartCount !== null && data.cartCount > 0 && (
                <span className={styles.badge} aria-hidden="true">
                  {formatPersianNumber(Math.min(data.cartCount, 99))}
                  {data.cartCount > 99 ? "+" : ""}
                </span>
              )}
            </Link>
          </nav>
        </div>
      </header>
      {(!data.settingsAvailable || data.account.state === "unavailable") && (
        <p className={styles.offlineNotice} role="status">
          برخی اطلاعات فروشگاه در دسترس نیست. لطفاً اتصال خود را بررسی و صفحه را تازه‌سازی کنید.
        </p>
      )}
      <main id="storefront-content" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <p>تمامی حقوق برای کافه آرمانی محفوظ است.</p>
        <p>
          طراحی و توسعه:{" "}
          <a
            href="https://www.instagram.com/hamidreza_hz98"
            target="_blank"
            rel="noopener noreferrer"
          >
            حمیدرضا حسن‌زاده
          </a>
        </p>
      </footer>
    </div>
  );
}
