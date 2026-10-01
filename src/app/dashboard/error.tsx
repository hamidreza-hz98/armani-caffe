"use client";

import Link from "next/link";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main
      role="alert"
      style={{ maxWidth: 520, margin: "10vh auto", padding: 24, textAlign: "center" }}
    >
      <h1>پنل مدیریت در دسترس نیست</h1>
      <p>بارگذاری اطلاعات انجام نشد. اتصال را بررسی و دوباره تلاش کنید.</p>
      <button type="button" onClick={reset}>
        تلاش دوباره
      </button>
      <p>
        <Link href="/dashboard/login">بازگشت به ورود</Link>
      </p>
    </main>
  );
}
