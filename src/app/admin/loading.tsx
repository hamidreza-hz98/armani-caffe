export default function AdminLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      style={{ maxWidth: 600, margin: "10vh auto", padding: 24 }}
    >
      <p>در حال بارگذاری پنل مدیریت…</p>
    </main>
  );
}
