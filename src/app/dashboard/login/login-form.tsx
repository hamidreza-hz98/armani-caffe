"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import styles from "./login.module.css";

export function DashboardLoginForm({ destination }: { destination: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      const result = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!response.ok || !result.ok) {
        setMessage(result.error?.message ?? "ورود انجام نشد. دوباره تلاش کنید.");
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setMessage("ارتباط با سرویس برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className={styles.page}>
      <section className={styles.formSide}>
        <div className={styles.formWrap}>
          <div className={styles.mobileBrand}>
            <span className={styles.brandMark}>آ</span>
            <span>کافه آرمانی</span>
          </div>
          <p className={styles.eyebrow}>پنل کنترل پرسنل مجاز</p>
          <h1>ورود به پنل مدیریت</h1>
          <p className={styles.intro}>برای مدیریت سفارش‌ها، محصولات و عملیات کافه وارد شوید.</p>
          <form onSubmit={submit} className={styles.form}>
            <label htmlFor="admin-username">نام کاربری، ایمیل یا موبایل</label>
            <input
              id="admin-username"
              name="username"
              type="text"
              autoComplete="username"
              dir="ltr"
              required
              maxLength={80}
              disabled={pending}
            />
            <label htmlFor="admin-password">رمز عبور</label>
            <div className={styles.password}>
              <input
                id="admin-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                dir="ltr"
                required
                maxLength={128}
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"}
                aria-pressed={visible}
              >
                {visible ? "پنهان" : "نمایش"}
              </button>
            </div>
            {message && (
              <p className={styles.error} role="alert">
                {message}
              </p>
            )}
            <button className={styles.submit} type="submit" disabled={pending}>
              {pending ? "در حال ورود…" : "ورود به داشبورد مدیریت"}
            </button>
          </form>
          <p className={styles.note}>دسترسی این بخش فقط برای کارکنان مجاز است.</p>
          <Link href="/" className={styles.back}>
            بازگشت به وب‌سایت کافه
          </Link>
        </div>
      </section>
      <section className={styles.visual} aria-hidden="true">
        <div className={styles.visualContent}>
          <span className={styles.brandMark}>آ</span>
          <strong>کافه آرمانی</strong>
          <p>هماهنگی بی‌نقص، از دانه‌های سبز تا فنجان اسپرسو.</p>
          <small>مدیریت سفارش‌های حضوری، موجودی و محتوای منو</small>
        </div>
      </section>
    </main>
  );
}
