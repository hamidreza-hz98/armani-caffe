import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatPersianNumber } from "@/theme/format";

import { ContactSheet } from "./contact-sheet";
import { CustomerAccountControl } from "./customer-account-control";
import { CustomerAuthSheet } from "./customer-auth-sheet";
import type { StorefrontShellData } from "./data";
import { StorefrontIcon } from "./icons";
import styles from "./storefront.module.css";

export function StorefrontHeader({ data }: { data: StorefrontShellData }) {
  const accountLabel =
    data.account.state === "customer"
      ? data.account.name || "حساب من"
      : data.account.state === "guest"
        ? "ورود"
        : "حساب نامشخص";
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="صفحه اصلی آرمانی کافه">
            <Image
              src={data.businessLogoUrl ?? "/armani-icon.svg"}
              alt=""
              width={52}
              height={52}
              priority
              unoptimized
            />
            <span>
              <strong>{data.businessName}</strong>
              <small>کافه و سفارش آنلاین</small>
            </span>
          </Link>
          <nav className={styles.actions} aria-label="ابزارهای فروشگاه">
            <ContactSheet links={data.contacts} address={data.contactAddress} />
            <CustomerAccountControl state={data.account.state} label={accountLabel} />
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
    </>
  );
}

export function StorefrontHeaderFallback() {
  return (
    <header className={styles.header} aria-label="در حال آماده‌سازی ابزارهای فروشگاه">
      <div className={styles.headerInner}>
        <span className={styles.brand}>
          <Image src="/brand/armani-logo.png" alt="" width={42} height={42} priority unoptimized />
          <span>
            <strong>آرمانی کافه</strong>
            <small>کافه و سفارش آنلاین</small>
          </span>
        </span>
        <span className={styles.headerSkeleton} aria-hidden="true" />
      </div>
    </header>
  );
}

export function StorefrontFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#storefront-content">
        رفتن به محتوای اصلی
      </a>
      {header}
      <CustomerAuthSheet />
      <main id="storefront-content" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <p>تمامی حقوق برای آرمانی کافه محفوظ است.</p>
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

export function StorefrontShell({
  data,
  children,
}: {
  data: StorefrontShellData;
  children: ReactNode;
}) {
  return <StorefrontFrame header={<StorefrontHeader data={data} />}>{children}</StorefrontFrame>;
}
