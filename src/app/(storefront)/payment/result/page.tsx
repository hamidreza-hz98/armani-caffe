import Link from "next/link";

export default function UnresolvedPaymentPage() {
  return (
    <section style={{ maxWidth: 520, margin: "24px auto", padding: 24, textAlign: "center" }}>
      <h1>نتیجه پرداخت قابل تأیید نیست</h1>
      <p>
        اطلاعات بازگشت از درگاه معتبر نبود. این صفحه به‌معنی پرداخت موفق یا ثبت سفارش نیست. برای
        بررسی با کافه تماس بگیرید.
      </p>
      <Link href="/">بازگشت به منو</Link>
    </section>
  );
}
