import styles from "@/storefront/storefront.module.css";

export default function StorefrontLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-live="polite">
      <div className={styles.header} style={{ minHeight: 72 }} />
      <main className={styles.main}>
        <div className={styles.hero}>
          <p>در حال آماده‌سازی فروشگاه…</p>
        </div>
      </main>
    </div>
  );
}
