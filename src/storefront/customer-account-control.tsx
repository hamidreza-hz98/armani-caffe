"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { customerAuthRequest } from "./customer-auth-client";
import { CUSTOMER_LOGGED_OUT, openCustomerAuth } from "./customer-auth-events";
import { StorefrontIcon } from "./icons";
import styles from "./storefront.module.css";

export function CustomerAccountControl({
  state,
  label,
}: {
  state: "guest" | "customer" | "unavailable";
  label: string;
}) {
  if (state !== "guest")
    return (
      <Link
        className={styles.iconLink}
        href="/account"
        aria-label={state === "customer" ? `حساب ${label}` : label}
        title={label}
      >
        <StorefrontIcon name="user" />
        <span className={styles.accountText}>{label}</span>
      </Link>
    );
  return (
    <button
      type="button"
      className={styles.iconLink}
      aria-label="ورود یا ثبت‌نام"
      title="ورود"
      onClick={() => openCustomerAuth()}
    >
      <StorefrontIcon name="user" />
      <span className={styles.accountText}>ورود</span>
    </button>
  );
}

export function AccountActions({ customer }: { customer: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!customer)
    return (
      <button type="button" onClick={() => openCustomerAuth()}>
        ورود یا ثبت‌نام
      </button>
    );
  async function logout() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await customerAuthRequest("logout", {});
      window.dispatchEvent(new Event(CUSTOMER_LOGGED_OUT));
      router.refresh();
    } catch {
      setError("خروج انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button type="button" disabled={pending} onClick={() => void logout()}>
        {pending ? "در حال خروج…" : "خروج از حساب"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
