import Link from "next/link";

export default function DashboardForbidden() {
  return (
    <main style={{ maxWidth: 520, margin: "10vh auto", padding: 24, textAlign: "center" }}>
      <h1>۴۰۳ — دسترسی مجاز نیست</h1>
      <p>نقش فعلی شما اجازه مشاهده این بخش را ندارد.</p>
      <Link href="/dashboard">بازگشت به داشبورد</Link>
    </main>
  );
}
