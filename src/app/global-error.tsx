"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          background: "#F7F2EA",
          color: "#211A16",
          fontFamily: "Tahoma, sans-serif",
          margin: 0,
          padding: "4rem 1.5rem",
        }}
      >
        <main>
          <h1>مشکلی پیش آمد</h1>
          <p>صفحه بارگذاری نشد. لطفاً دوباره تلاش کنید.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0.5rem 1rem" }}>
            تلاش دوباره
          </button>
        </main>
      </body>
    </html>
  );
}
