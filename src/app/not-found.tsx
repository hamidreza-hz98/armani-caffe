import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 600, margin: "10vh auto", padding: 24 }}>
      <h1>صفحه پیدا نشد</h1>
      <p>آدرس درخواستی وجود ندارد یا جابه‌جا شده است.</p>
      <Link href="/">بازگشت به صفحهٔ اصلی</Link>
    </main>
  );
}
