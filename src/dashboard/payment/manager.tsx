"use client";

import { useRef, useState } from "react";

import { useFeedback } from "@/theme/feedback-provider";
import { useUnsavedChanges } from "@/theme/unsaved-changes";

import { probePayment, readPaymentSettings, writePaymentSettings } from "./api";
import {
  disableProvider,
  moveProvider,
  orderedProviders,
  type PaymentSettingsView,
  type PaymentValues,
  type ProbeResult,
  type ProviderEntry,
} from "./model";
import styles from "./payment.module.css";

export function PaymentSettingsManager({ initial }: { initial: PaymentSettingsView }) {
  const [confirmed, setConfirmed] = useState(initial);
  const [draft, setDraft] = useState<PaymentValues>(initial.values);
  const [editing, setEditing] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState("");
  const [credentialPatch, setCredentialPatch] = useState<{
    id: string;
    value: string | null;
  } | null>(null);
  const [rotate, setRotate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saveKey = useRef<string | null>(null);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(confirmed.values) || !!credentialPatch || rotate;
  const feedback = useFeedback();
  useUnsavedChanges(dirty);
  const update = (next: PaymentValues) => {
    setDraft(next);
    saveKey.current = null;
    setMessage("");
    setError("");
  };
  const current = orderedProviders(draft);
  const selectable = confirmed.adapters.filter(
    (adapter) => adapter.selectable && adapter.id !== "fake",
  );
  const available = selectable.filter(
    (adapter) => !current.some((entry) => entry.id === adapter.id),
  );
  const active = current.filter((entry) => entry.enabled).length + Number(draft.fakeEnabled);
  function editProvider(id: string) {
    if (credentialPatch && credentialPatch.id !== id) {
      setError("ابتدا تغییر اعتبارنامهٔ درگاه دیگر را ذخیره کنید.");
      return;
    }
    setNewSecret("");
    setEditing(id);
    setError("");
  }
  function saveSecret() {
    if (!editing) return;
    if (newSecret && (newSecret.length < 16 || newSecret.length > 768)) {
      setError("مقدار محرمانه باید ۱۶ تا ۷۶۸ نویسه باشد.");
      return;
    }
    if (newSecret) {
      setCredentialPatch({ id: editing, value: newSecret });
      saveKey.current = null;
    }
    setNewSecret("");
    setEditing(null);
  }
  function toggle(entry: ProviderEntry) {
    if (entry.enabled) {
      update(disableProvider(draft, entry.id));
      return;
    }
    if (!confirmed.configuredIds.includes(entry.id) && credentialPatch?.id !== entry.id) {
      setError("ابتدا اعتبارنامهٔ این درگاه را وارد و ذخیره کنید.");
      editProvider(entry.id);
      return;
    }
    update({
      ...draft,
      providers: current.map((row) => (row.id === entry.id ? { ...row, enabled: true } : row)),
    });
  }
  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    try {
      saveKey.current ??= `payment_${crypto.randomUUID().replaceAll("-", "")}`;
      const updated = await writePaymentSettings(
        {
          revision: confirmed.revision,
          values: draft,
          rotate,
          ...(credentialPatch ? { credentialPatch } : {}),
        },
        saveKey.current,
      );
      setConfirmed(updated);
      setDraft(updated.values);
      setCredentialPatch(null);
      setRotate(false);
      setNewSecret("");
      setEditing(null);
      saveKey.current = null;
      setMessage("تنظیمات پرداخت ذخیره شد.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تنظیمات ذخیره نشد.");
      if (cause instanceof Error && "code" in cause && cause.code === "CONFLICT") {
        try {
          const latest = await readPaymentSettings();
          setConfirmed(latest);
        } catch {
          /* preserve local draft */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function testConnection(id: string) {
    if (probing) return;
    setProbing(id);
    setError("");
    try {
      const result = await probePayment(id);
      setHealth((current) => ({ ...current, [id]: result }));
    } catch (cause) {
      setHealth((current) => ({
        ...current,
        [id]: {
          status: "failed",
          message: cause instanceof Error ? cause.message : "آزمون اتصال ناموفق بود.",
          checkedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setProbing(null);
    }
  }
  async function copyCallback(id: string) {
    const value = confirmed.adapters.find((adapter) => adapter.id === id)?.callbackUrl;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage("الگوی آدرس بازگشت کپی شد؛ شناسهٔ تراکنش را سرور جایگزین می‌کند.");
    } catch {
      setError("کپی خودکار ممکن نشد. آدرس را انتخاب و دستی کپی کنید.");
    }
  }
  const fake = confirmed.adapters.find((adapter) => adapter.id === "fake")!;
  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>تنظیمات سیستم / پرداخت</p>
          <h1>درگاه‌های پرداخت</h1>
          <p>
            فقط آداپتورهای نصب‌شده در سمت سرور قابل انتخاب‌اند. این صفحه درگاه بانکی جدیدی نصب
            نمی‌کند.
          </p>
        </div>
        <button className={styles.primary} disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
      </div>
      <div className={styles.metrics}>
        <Metric label="درگاه‌های فعال" value={String(active)} />
        <Metric label="پیش‌فرض" value={draft.defaultProvider ?? "تعیین نشده"} ltr />
        <Metric
          label="اعتبارنامه"
          value={confirmed.credentialConfigured ? "ثبت‌شده و پنهان" : "ثبت نشده"}
        />
        <Metric label="آداپتور واقعی نصب‌شده" value={String(selectable.length)} />
      </div>
      <p className={styles.notice}>
        وضعیت اتصال زیر فقط نتیجهٔ آخرین آزمون همین صفحه است، نه تضمین پذیرش تراکنش. بدون پروب
        مستند، وضعیت «نامشخص» می‌ماند. درگاه جایگزین به‌صورت خودکار فعال نمی‌شود.
      </p>
      {dirty && (
        <p role="status" className={styles.warning}>
          تغییرات ذخیره‌نشده دارید. بازگشت یا بستن صفحه آن‌ها را از دست می‌دهد.
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
      <div className={styles.sectionHead}>
        <h2>درگاه‌ها و اولویت‌ها</h2>
        <label>
          افزودن درگاه نصب‌شده
          <select
            aria-label="افزودن درگاه نصب‌شده"
            value=""
            disabled={!available.length || current.length >= 4}
            onChange={(event) => {
              const id = event.target.value;
              if (!id) return;
              update({
                ...draft,
                providers: [
                  ...current,
                  { id, enabled: false, priority: current.length, mode: "sandbox" },
                ],
              });
              editProvider(id);
            }}
          >
            <option value="">انتخاب درگاه</option>
            {available.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!available.length && (
        <p className={styles.hint}>
          در حال حاضر آداپتور بانکی مستندی نصب نیست؛ برای افزودن درگاه واقعی، آداپتور سمت سرور و
          پروب آن باید پیاده‌سازی شود.
        </p>
      )}
      <div className={styles.cards}>
        <article className={styles.card}>
          <div className={styles.cardTop}>
            <div>
              <h3>
                {fake.label} <bdi dir="ltr">(fake)</bdi>
              </h3>
              <p>فقط توسعه؛ در محیط عملیاتی قابل فعال‌سازی نیست.</p>
            </div>
            <span className={styles.badge}>{draft.fakeEnabled ? "فعال" : "غیرفعال"}</span>
          </div>
          <div className={styles.fields}>
            <span>حالت: شبیه‌سازی</span>
            <span>پیش‌فرض: {draft.defaultProvider === "fake" ? "بله" : "خیر"}</span>
            <span>وضعیت: {health.fake?.message ?? "آزمون نشده"}</span>
          </div>
          <div className={styles.actions}>
            <button
              disabled={confirmed.production}
              onClick={() =>
                update(
                  draft.fakeEnabled
                    ? disableProvider(draft, "fake")
                    : {
                        ...draft,
                        fakeEnabled: true,
                        defaultProvider: draft.defaultProvider ?? "fake",
                      },
                )
              }
            >
              {draft.fakeEnabled ? "غیرفعال‌سازی" : "فعال‌سازی"}
            </button>
            <button
              disabled={!draft.fakeEnabled}
              onClick={() => update({ ...draft, defaultProvider: "fake" })}
            >
              پیش‌فرض
            </button>
            <button onClick={() => void copyCallback("fake")}>کپی آدرس بازگشت</button>
            <button
              disabled={confirmed.production || !!probing}
              onClick={() => void testConnection("fake")}
            >
              {probing === "fake" ? "در حال آزمون…" : "آزمون شبیه‌ساز"}
            </button>
          </div>
        </article>
        {current.map((entry, index) => {
          const adapter = confirmed.adapters.find((row) => row.id === entry.id);
          const check = health[entry.id];
          return (
            <article key={entry.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div>
                  <h3>
                    {adapter?.label ?? entry.id} <bdi dir="ltr">({entry.id})</bdi>
                  </h3>
                  <p>
                    {adapter?.installed
                      ? "آداپتور سمت سرور نصب است."
                      : "آداپتور نصب نیست؛ تنظیمات ذخیره‌شده باید بازبینی شود."}
                  </p>
                </div>
                <span className={styles.badge}>{entry.enabled ? "فعال" : "غیرفعال"}</span>
              </div>
              <div className={styles.fields}>
                <span>حالت: {entry.mode === "sandbox" ? "آزمایشی" : "عملیاتی"}</span>
                <span>اولویت: {(index + 1).toLocaleString("fa-IR")}</span>
                <span>پیش‌فرض: {draft.defaultProvider === entry.id ? "بله" : "خیر"}</span>
                <span>
                  اعتبارنامه:{" "}
                  {credentialPatch?.id === entry.id
                    ? "تغییر در انتظار ذخیره"
                    : confirmed.configuredIds.includes(entry.id)
                      ? "ثبت‌شده (مقدار پنهان)"
                      : "ثبت نشده"}
                </span>
                <span>اتصال: {check?.message ?? "آزمون نشده"}</span>
              </div>
              <div className={styles.actions}>
                <button disabled={!adapter?.selectable} onClick={() => toggle(entry)}>
                  {entry.enabled ? "غیرفعال‌سازی" : "فعال‌سازی"}
                </button>
                <button
                  disabled={!entry.enabled}
                  onClick={() => update({ ...draft, defaultProvider: entry.id })}
                >
                  انتخاب پیش‌فرض
                </button>
                <button disabled={!adapter?.selectable} onClick={() => editProvider(entry.id)}>
                  ویرایش
                </button>
                <button
                  disabled={!adapter?.selectable}
                  onClick={async () => {
                    if (credentialPatch && credentialPatch.id !== entry.id) {
                      setError("ابتدا تغییر اعتبارنامهٔ درگاه دیگر را ذخیره کنید.");
                      return;
                    }
                    if (
                      !(await feedback.confirm({
                        title: "حذف درگاه از پیکربندی؟",
                        description: `درگاه ${entry.id} حذف می‌شود و اعتبارنامهٔ ذخیره‌شده نیز هنگام ذخیره پاک خواهد شد.`,
                        confirmLabel: "حذف درگاه",
                        dangerous: true,
                      }))
                    )
                      return;
                    update({
                      ...draft,
                      defaultProvider:
                        draft.defaultProvider === entry.id ? null : draft.defaultProvider,
                      providers: current
                        .filter((row) => row.id !== entry.id)
                        .map((row, priority) => ({ ...row, priority })),
                    });
                    setCredentialPatch({ id: entry.id, value: null });
                    setEditing(null);
                    setNewSecret("");
                  }}
                >
                  حذف از پیکربندی
                </button>
                <button
                  disabled={index === 0}
                  aria-label={`افزایش اولویت ${entry.id}`}
                  onClick={() => update(moveProvider(draft, entry.id, -1))}
                >
                  ↑
                </button>
                <button
                  disabled={index === current.length - 1}
                  aria-label={`کاهش اولویت ${entry.id}`}
                  onClick={() => update(moveProvider(draft, entry.id, 1))}
                >
                  ↓
                </button>
                <button disabled={!!probing} onClick={() => void testConnection(entry.id)}>
                  {probing === entry.id ? "در حال آزمون…" : "آزمون اتصال"}
                </button>
                <button onClick={() => void copyCallback(entry.id)}>کپی آدرس بازگشت</button>
              </div>
            </article>
          );
        })}
        <article className={`${styles.card} ${styles.unavailable}`}>
          <h3>
            درگاه ایرانی <bdi dir="ltr">(iranian-gateway)</bdi>
          </h3>
          <p>
            مرز کد آماده است اما آداپتور رسمی و پروب اتصال نصب نشده‌اند. این گزینه قابل فعال‌سازی یا
            پیش‌فرض‌کردن نیست.
          </p>
          <button onClick={() => void testConnection("iranian-gateway")}>بررسی وضعیت نصب</button>
          <button onClick={() => void copyCallback("iranian-gateway")}>
            کپی الگوی آدرس بازگشت
          </button>
          {health["iranian-gateway"] && <p role="status">{health["iranian-gateway"].message}</p>}
        </article>
      </div>
      <div className={styles.footerActions}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={rotate}
            onChange={(event) => {
              setRotate(event.target.checked);
              saveKey.current = null;
            }}
          />{" "}
          چرخش رمزنگاری اعتبارنامه‌های ذخیره‌شده هنگام ذخیره
        </label>
        <button className={styles.primary} disabled={!dirty || busy} onClick={() => void save()}>
          ذخیره تغییرات
        </button>
      </div>
      {editing && (
        <div className={styles.backdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-edit-title"
          >
            <h2 id="provider-edit-title">ویرایش {editing}</h2>
            <label>
              حالت درگاه
              <select
                value={current.find((entry) => entry.id === editing)?.mode ?? "sandbox"}
                onChange={(event) =>
                  update({
                    ...draft,
                    providers: current.map((entry) =>
                      entry.id === editing
                        ? { ...entry, mode: event.target.value as "sandbox" | "production" }
                        : entry,
                    ),
                  })
                }
              >
                <option value="sandbox">آزمایشی</option>
                <option value="production">عملیاتی</option>
              </select>
            </label>
            <label>
              اعتبارنامهٔ جدید
              <input
                autoFocus
                type="password"
                autoComplete="new-password"
                minLength={16}
                maxLength={768}
                value={newSecret}
                onChange={(event) => setNewSecret(event.target.value)}
                placeholder="خالی = بدون تغییر"
              />
            </label>
            <p className={styles.hint}>
              اعتبارنامهٔ قبلی هرگز خوانده یا نمایش داده نمی‌شود. برای جایگزینی، مقدار جدید را وارد
              کنید؛ خالی بگذارید تا بدون تغییر بماند.
            </p>
            <label>
              آدرس بازگشت (فقط خواندنی)
              <div className={styles.callback}>
                <code dir="ltr">
                  {confirmed.adapters.find((adapter) => adapter.id === editing)?.callbackUrl}
                </code>
                <button
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      confirmed.adapters.find((adapter) => adapter.id === editing)?.callbackUrl ??
                        "",
                    )
                  }
                >
                  کپی
                </button>
              </div>
            </label>
            <div className={styles.actions}>
              <button
                onClick={() => {
                  setNewSecret("");
                  setEditing(null);
                }}
              >
                انصراف
              </button>
              <button className={styles.primary} onClick={saveSecret}>
                اعمال در فرم
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function Metric({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong dir={ltr ? "ltr" : undefined}>{value}</strong>
    </div>
  );
}
