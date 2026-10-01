export default function DashboardLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      style={{ maxWidth: 850, margin: "10vh auto", padding: 24 }}
    >
      <p>در حال بارگذاری پنل مدیریت…</p>
      <div style={{ height: 70, background: "#eee4d7", borderRadius: 16, marginBlock: 16 }} />
      <div style={{ height: 220, background: "#eee4d7", borderRadius: 16 }} />
    </main>
  );
}
