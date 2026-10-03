"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { formatJalaliDate } from "@/theme/format";

import { inventoryRequest, loadInventory, loadMovements } from "./api";
import { ChangeDialog } from "./change-dialog";
import { useInventoryDialogFocus } from "./dialog-focus";
import { ItemEditor } from "./editor";
import styles from "./inventory.module.css";
import type { InventoryItem, InventorySnapshot, StockMovement, StockRequest } from "./model";
import { requestLabels, unitLabels } from "./model";

type StatusFilter = "all" | "low" | "out" | "archived";
export function InventoryManager({
  initial,
  isOwner,
  query,
  status,
}: {
  initial: InventorySnapshot;
  isOwner: boolean;
  query: string;
  status: StatusFilter;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<"stock" | "approvals">("stock");
  const [editing, setEditing] = useState<InventoryItem | "new" | null>(null);
  const [changing, setChanging] = useState<InventoryItem | null>(null);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [decision, setDecision] = useState<{
    request: StockRequest;
    value: "approved" | "rejected";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [movementError, setMovementError] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const decisionRef = useRef<HTMLElement>(null);
  useInventoryDialogFocus(detailRef, Boolean(selected), () => setSelected(null));
  useInventoryDialogFocus(decisionRef, Boolean(decision), () => setDecision(null));
  const counts = useMemo(
    () => ({
      active: snapshot.items.filter((row) => row.status === "active").length,
      low: snapshot.items.filter((row) => row.status === "active" && row.stockStatus === "low")
        .length,
      out: snapshot.items.filter((row) => row.status === "active" && row.stockStatus === "out")
        .length,
      pending: snapshot.requests.filter((row) => row.status === "pending").length,
    }),
    [snapshot],
  );
  const visible = snapshot.items.filter(
    (row) =>
      (status === "all"
        ? row.status === "active"
        : status === "archived"
          ? row.status === "archived"
          : row.status === "active" && row.stockStatus === status) &&
      (!query || row.name.toLocaleLowerCase("fa-IR").includes(query.toLocaleLowerCase("fa-IR"))),
  );
  async function refresh() {
    const updated = await loadInventory();
    setSnapshot(updated);
    if (selected) setSelected(updated.items.find((item) => item.id === selected.id) ?? null);
    if (selected) setMovements(await loadMovements(selected.id));
    router.refresh();
  }
  async function openItem(item: InventoryItem) {
    setSelected(item);
    setMovementError("");
    setMovements([]);
    try {
      setMovements(await loadMovements(item.id));
    } catch (cause) {
      setMovementError(cause instanceof Error ? cause.message : "گردش موجودی در دسترس نیست.");
    }
  }
  async function openChange(item: InventoryItem) {
    setMovementError("");
    try {
      setMovements(await loadMovements(item.id));
      setChanging(item);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "گردش موجودی در دسترس نیست.");
    }
  }
  async function decide() {
    if (!decision || busy) return;
    setBusy(true);
    setError("");
    try {
      await inventoryRequest(`/api/inventory/requests/${decision.request.id}/decision`, "POST", {
        decision: decision.value,
      });
      setDecision(null);
      setMessage("تصمیم ثبت شد؛ موجودی تأییدشده تازه‌سازی شد.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تصمیم ثبت نشد.");
      try {
        await refresh();
      } catch {
        /* keep last confirmed snapshot */
      }
      setDecision(null);
    } finally {
      setBusy(false);
    }
  }
  const nameFor = (id: string) =>
    snapshot.items.find((item) => item.id === id)?.name ?? "قلم حذف‌شده";
  const actorFor = (id: string | null) => (id ? (snapshot.actors[id] ?? "مدیر سیستم") : "سیستم");
  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>مدیریت عملیاتی / انبار</p>
          <h1>موجودی و تأییدها</h1>
          <p>موجودی قطعی از دفتر گردش محاسبه می‌شود؛ درخواست‌های در انتظار در آن منظور نمی‌شوند.</p>
        </div>
        <div className={styles.headingActions}>
          {isOwner && (
            <button className={styles.primary} onClick={() => setEditing("new")}>
              افزودن قلم
            </button>
          )}
          <button
            onClick={() => {
              setTab("approvals");
              document.getElementById("approvals-heading")?.focus();
            }}
          >
            صف تأییدها ({counts.pending.toLocaleString("fa-IR")})
          </button>
        </div>
      </div>
      <div className={styles.metrics} aria-label="خلاصه موجودی">
        <Metric label="اقلام فعال" value={counts.active} />
        <Metric label="کم‌موجود" value={counts.low} tone="warn" />
        <Metric label="ناموجود" value={counts.out} tone="danger" />
        <Metric label="در انتظار تأیید" value={counts.pending} tone="pending" />
      </div>
      {snapshot.truncated && (
        <p role="status" className={styles.warning}>
          فهرست به سقف نمایش رسیده است؛ نتایج بیشتر در این نما نشان داده نمی‌شوند.
        </p>
      )}
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.tabs} role="tablist" aria-label="بخش موجودی">
        <button role="tab" aria-selected={tab === "stock"} onClick={() => setTab("stock")}>
          اقلام موجودی
        </button>
        <button role="tab" aria-selected={tab === "approvals"} onClick={() => setTab("approvals")}>
          درخواست‌های تغییر ({counts.pending.toLocaleString("fa-IR")})
        </button>
      </div>
      {tab === "stock" ? (
        <>
          <form action="/dashboard/inventory" className={styles.filters}>
            <label>
              جستجوی نام
              <input name="q" defaultValue={query} placeholder="نام قلم" />
            </label>
            <label>
              وضعیت
              <select name="status" defaultValue={status}>
                <option value="all">اقلام فعال</option>
                <option value="low">کم‌موجود</option>
                <option value="out">ناموجود</option>
                <option value="archived">بایگانی‌شده</option>
              </select>
            </label>
            <button type="submit">اعمال فیلتر</button>
            {(query || status !== "all") && <Link href="/dashboard/inventory">پاک‌کردن</Link>}
          </form>
          {!visible.length ? (
            <p className={styles.empty}>قلمی با این فیلتر یافت نشد.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>قلم</th>
                    <th>موجودی تأییدشده</th>
                    <th>حد هشدار</th>
                    <th>وضعیت</th>
                    <th>آخرین تغییر</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id}>
                      <td data-label="قلم">
                        <strong>{item.name}</strong>
                        <small>{unitLabels[item.unit]}</small>
                      </td>
                      <td data-label="موجودی">
                        <strong>
                          {item.onHand.toLocaleString("fa-IR")} {unitLabels[item.unit]}
                        </strong>
                      </td>
                      <td data-label="حد هشدار">{item.reorderLevel.toLocaleString("fa-IR")}</td>
                      <td data-label="وضعیت">
                        <span className={`${styles.badge} ${styles[item.stockStatus]}`}>
                          {item.status === "archived"
                            ? "بایگانی"
                            : item.stockStatus === "out"
                              ? "ناموجود"
                              : item.stockStatus === "low"
                                ? "کم‌موجود"
                                : "موجود"}
                        </span>
                      </td>
                      <td data-label="آخرین تغییر">{formatJalaliDate(item.updatedAt, true)}</td>
                      <td data-label="عملیات">
                        <div className={styles.rowActions}>
                          <button onClick={() => void openItem(item)}>جزئیات و گردش</button>
                          {item.status === "active" && (
                            <button onClick={() => void openChange(item)}>ثبت تغییر</button>
                          )}
                          {isOwner && <button onClick={() => setEditing(item)}>ویرایش</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selected && (
            <div className={styles.modalBackdrop}>
              <section
                ref={detailRef}
                tabIndex={-1}
                className={`${styles.modal} ${styles.wideModal}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="stock-detail-title"
              >
                <div className={styles.dialogHead}>
                  <h2 id="stock-detail-title">{selected.name}</h2>
                  <button onClick={() => setSelected(null)} aria-label="بستن جزئیات">
                    ×
                  </button>
                </div>
                <p>
                  موجودی قطعی:{" "}
                  <strong>
                    {selected.onHand.toLocaleString("fa-IR")} {unitLabels[selected.unit]}
                  </strong>{" "}
                  · حد هشدار: {selected.reorderLevel.toLocaleString("fa-IR")}
                </p>
                <h3>محصولات مصرف‌کننده</h3>
                {snapshot.mappings.filter((row) => row.itemId === selected.id).length ? (
                  <ul>
                    {snapshot.mappings
                      .filter((row) => row.itemId === selected.id)
                      .map((row) => (
                        <li key={row.productId}>
                          <Link href={`/dashboard/products/${row.productId}`}>
                            {row.productName}
                          </Link>{" "}
                          — {row.quantityPerUnit.toLocaleString("fa-IR")}{" "}
                          {unitLabels[selected.unit]} در هر سفارش
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className={styles.hint}>محصول فعالی به این قلم متصل نیست.</p>
                )}
                <h3>دفتر گردش (حداکثر ۲۰۰ حرکت اخیر)</h3>
                {movementError && (
                  <p role="alert" className={styles.error}>
                    {movementError}
                  </p>
                )}
                {!movements.length ? (
                  <p className={styles.hint}>حرکتی ثبت نشده است.</p>
                ) : (
                  <div className={styles.ledger}>
                    <table>
                      <thead>
                        <tr>
                          <th>زمان</th>
                          <th>دلیل</th>
                          <th>قبل</th>
                          <th>تغییر</th>
                          <th>بعد</th>
                          <th>عامل</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((row) => (
                          <tr key={row.id}>
                            <td>{formatJalaliDate(row.createdAt, true)}</td>
                            <td>
                              {requestLabels[row.reason as keyof typeof requestLabels] ??
                                (row.reason === "sale" ? "مصرف سفارش" : row.reason)}
                            </td>
                            <td>{row.before.toLocaleString("fa-IR")}</td>
                            <td>
                              <bdi dir="ltr">
                                {row.delta > 0 ? "+" : ""}
                                {row.delta.toLocaleString("fa-IR")}
                              </bdi>
                            </td>
                            <td>{row.after.toLocaleString("fa-IR")}</td>
                            <td>{row.actorKind === "system" ? "سیستم" : actorFor(row.actorId)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className={styles.actions}>
                  {selected.status === "active" && (
                    <button
                      className={styles.primary}
                      onClick={() => {
                        const item = selected;
                        setSelected(null);
                        void openChange(item);
                      }}
                    >
                      ثبت تغییر
                    </button>
                  )}
                  <button onClick={() => setSelected(null)}>بستن</button>
                </div>
              </section>
            </div>
          )}
        </>
      ) : (
        <section aria-labelledby="approvals-heading">
          <h2 id="approvals-heading" tabIndex={-1}>
            صف درخواست‌ها
          </h2>
          <p className={styles.hint}>تغییر پیشنهادی تا زمان تأیید مدیر در موجودی اعمال نمی‌شود.</p>
          {!snapshot.requests.length ? (
            <p className={styles.empty}>درخواستی ثبت نشده است.</p>
          ) : (
            <div className={styles.requests}>
              {snapshot.requests.map((request) => {
                const item = snapshot.items.find((row) => row.id === request.inventoryItemId);
                const proposed =
                  item && request.status === "pending"
                    ? item.onHand + request.requestedDelta
                    : null;
                return (
                  <article key={request.id} className={styles.requestCard}>
                    <div className={styles.requestTop}>
                      <h3>
                        {requestLabels[request.kind]} · {nameFor(request.inventoryItemId)}
                      </h3>
                      <span
                        className={`${styles.badge} ${request.status === "pending" ? styles.pending : request.status === "approved" ? styles.available : styles.out}`}
                      >
                        {request.status === "pending"
                          ? "در انتظار"
                          : request.status === "approved"
                            ? "تأییدشده"
                            : "ردشده"}
                      </span>
                    </div>
                    <p>{request.reason}</p>
                    <div className={styles.requestFacts}>
                      <span>
                        تغییر:{" "}
                        <bdi dir="ltr">
                          {request.requestedDelta > 0 ? "+" : ""}
                          {request.requestedDelta.toLocaleString("fa-IR")}
                        </bdi>{" "}
                        {unitLabels[request.unit]}
                      </span>
                      {item && (
                        <span>
                          موجودی فعلی: {item.onHand.toLocaleString("fa-IR")} {unitLabels[item.unit]}
                        </span>
                      )}
                      {proposed !== null && (
                        <span>در صورت تأیید: {proposed.toLocaleString("fa-IR")}</span>
                      )}
                      <span>درخواست‌کننده: {actorFor(request.requestedBy)}</span>
                      <span>زمان: {formatJalaliDate(request.createdAt, true)}</span>
                      {request.decidedBy && (
                        <span>تصمیم‌گیرنده: {actorFor(request.decidedBy)}</span>
                      )}
                    </div>
                    {request.status === "pending" && isOwner && (
                      <div className={styles.actions}>
                        <button
                          className={styles.primary}
                          onClick={() => setDecision({ request, value: "approved" })}
                        >
                          تأیید
                        </button>
                        <button onClick={() => setDecision({ request, value: "rejected" })}>
                          رد درخواست
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
      {editing && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {changing && (
        <ChangeDialog
          item={changing}
          isOwner={isOwner}
          movements={movements}
          onClose={() => setChanging(null)}
          onSaved={refresh}
        />
      )}
      {decision && (
        <div className={styles.modalBackdrop}>
          <section
            ref={decisionRef}
            tabIndex={-1}
            className={styles.modal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="stock-decision-title"
            aria-describedby="stock-decision-desc"
          >
            <h2 id="stock-decision-title">
              {decision.value === "approved" ? "تأیید تغییر موجودی" : "رد درخواست"}
            </h2>
            <p id="stock-decision-desc">
              {requestLabels[decision.request.kind]} برای{" "}
              {nameFor(decision.request.inventoryItemId)} با تغییر{" "}
              {decision.request.requestedDelta.toLocaleString("fa-IR")}{" "}
              {unitLabels[decision.request.unit]}.{" "}
              {decision.value === "approved"
                ? "موجودی پس از ثبت حرکت قطعی تغییر می‌کند؛ اگر در این فاصله تغییر کرده باشد، سرور دوباره اعتبارسنجی می‌کند."
                : "درخواست بدون تغییر موجودی رد می‌شود."}
            </p>
            <div className={styles.actions}>
              <button disabled={busy} onClick={() => setDecision(null)}>
                انصراف
              </button>
              <button disabled={busy} className={styles.primary} onClick={() => void decide()}>
                {busy ? "در حال ثبت…" : decision.value === "approved" ? "تأیید نهایی" : "رد نهایی"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`${styles.metric} ${tone ? styles[tone] : ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString("fa-IR")}</strong>
    </div>
  );
}
