"use client";

import { Drawer } from "@mui/material";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { DashboardIcon } from "./icon";
import type { DashboardLink, DashboardRole } from "./navigation";
import styles from "./shell.module.css";

type Props = {
  links: readonly DashboardLink[];
  actor: { displayName: string; role: DashboardRole };
};

function NavItems({ links, onSelect }: { links: readonly DashboardLink[]; onSelect?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="ناوبری مدیریت" className={styles.nav}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onSelect}
          aria-current={path === link.href ? "page" : undefined}
          className={`${styles.navLink} ${path === link.href ? styles.active : ""}`}
        >
          <DashboardIcon name={link.icon} />
          <span>{link.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function DashboardChrome({ links, actor }: Props) {
  const router = useRouter();
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [profile, setProfile] = useState(false);
  const [notices, setNotices] = useState(false);
  const [query, setQuery] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const current = links.find((link) => link.href === path);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim().slice(0, 80);
    setProfile(false);
    setNotices(false);
    router.push(`/dashboard/orders${term ? `?q=${encodeURIComponent(term)}` : ""}`);
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Logout failed");
      router.replace("/dashboard/login");
      router.refresh();
    } catch {
      setError("خروج انجام نشد. دوباره تلاش کنید.");
    } finally {
      setLoggingOut(false);
    }
  }

  const sidebar = (
    <div className={styles.sideInner}>
      <Link href="/dashboard" className={styles.brand} onClick={() => setDrawer(false)}>
        <span className={styles.brandMark}>آ</span>
        <span>
          <strong>کافه آرمانی</strong>
          <small>پنل مدیریت</small>
        </span>
      </Link>
      <NavItems links={links} onSelect={() => setDrawer(false)} />
      <div className={styles.sideAccount}>
        <span className={styles.avatar}>{actor.displayName.charAt(0)}</span>
        <span>
          <strong>{actor.displayName}</strong>
          <small>{actor.role === "OWNER" ? "مدیر سیستم" : "صندوقدار"}</small>
        </span>
      </div>
    </div>
  );
  return (
    <>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <Drawer
        anchor="right"
        open={drawer}
        onClose={() => setDrawer(false)}
        slotProps={{ paper: { className: styles.mobileDrawer, dir: "rtl" } }}
      >
        <button
          className={styles.drawerClose}
          type="button"
          onClick={() => setDrawer(false)}
          aria-label="بستن منو"
        >
          <DashboardIcon name="close" />
        </button>
        {sidebar}
      </Drawer>
      <header className={styles.topbar}>
        <div className={styles.topStart}>
          <button
            type="button"
            className={styles.menuButton}
            aria-label="باز کردن منوی مدیریت"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <DashboardIcon name="menu" />
          </button>
          <div className={styles.breadcrumbs} aria-label="مسیر صفحه">
            <Link href="/dashboard">پنل مدیریت</Link>
            {path !== "/dashboard" && (
              <>
                <DashboardIcon name="chevron" />
                <span>{current?.label ?? "صفحه مدیریت"}</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.topActions}>
          <form role="search" className={styles.search} onSubmit={search}>
            <label className={styles.srOnly} htmlFor="dashboard-order-search">
              جستجوی سفارش
            </label>
            <input
              id="dashboard-order-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={80}
              placeholder="شماره سفارش"
            />
            <button type="submit" aria-label="جستجوی سفارش">
              <DashboardIcon name="search" />
            </button>
          </form>
          <div className={styles.popoverWrap}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="اعلان‌ها"
              aria-expanded={notices}
              onClick={() => {
                setNotices(!notices);
                setProfile(false);
              }}
            >
              <DashboardIcon name="bell" />
            </button>
            {notices && (
              <div className={styles.popover} role="status">
                <strong>اعلان‌ها</strong>
                <p>اعلان جدیدی برای نمایش در این بخش ثبت نشده است.</p>
              </div>
            )}
          </div>
          <div className={styles.popoverWrap}>
            <button
              type="button"
              className={styles.profileButton}
              aria-label={`پروفایل ${actor.displayName}`}
              aria-expanded={profile}
              onClick={() => {
                setProfile(!profile);
                setNotices(false);
              }}
            >
              <span className={styles.avatar}>{actor.displayName.charAt(0)}</span>
              <span className={styles.profileName}>{actor.displayName}</span>
            </button>
            {profile && (
              <div className={styles.popover}>
                <strong>{actor.displayName}</strong>
                <small>{actor.role === "OWNER" ? "مدیر سیستم" : "صندوقدار"}</small>
                <button type="button" disabled={loggingOut} onClick={() => void logout()}>
                  <DashboardIcon name="logout" />
                  {loggingOut ? "در حال خروج…" : "خروج از حساب"}
                </button>
                {error && <p role="alert">{error}</p>}
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
