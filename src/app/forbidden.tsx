import Link from "next/link";

export default function Forbidden() {
  return (
    <main style={{ maxWidth: 600, margin: "10vh auto", padding: 24, textAlign: "center" }}>
      <p aria-hidden="true" style={{ fontSize: 40, margin: 0 }}>
        ⊘
      </p>
      <h1>دسترسی به این بخش محدود است</h1>
      <p>حساب شما مجوز مشاهده یا تغییر این بخش را ندارد.</p>
      <Link href="/dashboard">بازگشت به داشبورد</Link>
    </main>
  );
}
