import styles from "@/storefront/storefront.module.css";

export default function Home() {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <span className={styles.heroEyebrow}>سفارش آنلاین کافه آرمانی</span>
      <h1 id="home-title">آرمانی کافه</h1>
      <p>
        به‌زودی منوی تازهٔ کافه اینجا در دسترس خواهد بود. برای ارتباط و مسیریابی از دکمهٔ «ارتباط با
        ما» استفاده کنید.
      </p>
    </section>
  );
}
