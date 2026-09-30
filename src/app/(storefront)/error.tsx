"use client";

import { Button } from "@mui/material";

import styles from "@/storefront/storefront.module.css";

export default function StorefrontError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className={styles.shell}>
      <div className={styles.main}>
        <section className={styles.hero} role="alert">
          <h1>فروشگاه در دسترس نیست</h1>
          <p>اتصال برقرار نشد. لطفاً دوباره تلاش کنید.</p>
          <Button variant="contained" onClick={reset}>
            تلاش دوباره
          </Button>
        </section>
      </div>
    </main>
  );
}
