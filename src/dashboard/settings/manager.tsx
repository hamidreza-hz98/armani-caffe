"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

import { MediaPicker } from "@/dashboard/media/picker";
import { type OwnerSettings, settingsMapUrl, type SettingsValues } from "@/modules/settings";
import { useFeedback } from "@/theme/feedback-provider";
import { useUnsavedChanges } from "@/theme/unsaved-changes";

import styles from "./settings.module.css";

const names = {
  business: "هویت کسب‌وکار",
  contact: "تماس و شبکه‌های اجتماعی",
  seo: "سئو",
  printing: "تنظیمات چاپ",
  payment: "درگاه‌های پرداخت",
} as const;
type EditableKind = "business" | "contact" | "seo" | "printing";
type Envelope =
  { ok: true; value: OwnerSettings } | { ok: false; error: { code: string; message: string } };

export function SettingsManager({ initial }: { initial: OwnerSettings }) {
  const kind = initial.kind as EditableKind;
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<SettingsValues[EditableKind]>(
    initial.values as SettingsValues[EditableKind],
  );
  const [bridgeToken, setBridgeToken] = useState("");
  const [picker, setPicker] = useState<"logoMediaId" | "faviconMediaId" | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.values) || !!bridgeToken;
  const feedback = useFeedback();
  useUnsavedChanges(dirty);
  function change<T extends EditableKind>(next: SettingsValues[T]) {
    setDraft(next);
    key.current = null;
    setStatus("");
    setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/settings/${kind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({
          revision: saved.revision,
          values: draft,
          ...(kind === "printing" && bridgeToken ? { secrets: { bridgeToken } } : {}),
        }),
      });
      const result = (await response.json()) as Envelope;
      if (!response.ok || !result.ok) {
        const code = result.ok ? "UNKNOWN" : result.error.code;
        setError(
          code === "CONFLICT"
            ? "تنظیمات هم‌زمان تغییر کرده‌اند. نسخهٔ سرور را بازخوانی کنید."
            : code === "VALIDATION"
              ? "مقادیر واردشده معتبر نیستند. قالب و محدودیت فیلدها را بررسی کنید."
              : "ذخیره انجام نشد. دوباره تلاش کنید.",
        );
        return;
      }
      setSaved(result.value);
      setDraft(result.value.values as SettingsValues[EditableKind]);
      setBridgeToken("");
      key.current = null;
      setStatus("تنظیمات ذخیره شد و اطلاعات عمومی در درخواست بعدی به‌روز می‌شود.");
    } catch {
      setError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (
      dirty &&
      !(await feedback.confirm({
        title: "کنارگذاشتن تغییرات؟",
        description: "مقادیر ذخیره‌نشده با نسخهٔ فعلی سرور جایگزین می‌شوند.",
        confirmLabel: "بازخوانی نسخهٔ سرور",
        dangerous: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/settings/${kind}`, { cache: "no-store" });
      const result = (await response.json()) as Envelope;
      if (!response.ok || !result.ok) throw new Error();
      setSaved(result.value);
      setDraft(result.value.values as SettingsValues[EditableKind]);
      setBridgeToken("");
      key.current = null;
      setError("");
      setStatus("نسخهٔ فعلی سرور بازخوانی شد.");
    } catch {
      setError("بازخوانی تنظیمات ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }
  const input = (
    label: string,
    field: string,
    value: string | number,
    options?: { type?: string; max?: number; dir?: "ltr" },
  ) => (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type={options?.type ?? "text"}
        dir={options?.dir}
        value={value}
        maxLength={options?.max}
        onChange={(event) => {
          const nextValue =
            options?.type === "number" ? Number(event.target.value) : event.target.value;
          change({ ...draft, [field]: nextValue } as SettingsValues[EditableKind]);
        }}
      />
    </label>
  );
  const business = draft as SettingsValues["business"];
  const contact = draft as SettingsValues["contact"];
  const seo = draft as SettingsValues["seo"];
  const printing = draft as SettingsValues["printing"];
  return (
    <section className={styles.page}>
      <nav className={styles.links} aria-label="بازگشت و تنظیمات">
        <Link href="/dashboard/settings">همهٔ تنظیمات</Link>
        <Link href="/dashboard/settings/payment">درگاه‌های پرداخت</Link>
      </nav>
      <header>
        <h1>{names[kind]}</h1>
        <p>فقط مالک می‌تواند این تنظیمات را تغییر دهد. نسخهٔ فعلی: {saved.revision}</p>
      </header>
      <form onSubmit={save} className={styles.form}>
        {kind === "business" && (
          <>
            {input("نام نمایشی کافه", "title", business.title, { max: 100 })}
            {input("نام حقوقی", "legalName", business.legalName, { max: 150 })}
            <label className={styles.field}>
              <span>معرفی کوتاه</span>
              <textarea
                value={business.description}
                maxLength={1000}
                onChange={(e) => change({ ...business, description: e.target.value })}
              />
            </label>
            {input("حداقل سفارش (تومان)", "minimumOrderToman", business.minimumOrderToman, {
              type: "number",
            })}
            <p>واحد پول: تومان · منطقهٔ زمانی: آسیا/تهران</p>
            {(["logoMediaId", "faviconMediaId"] as const).map((field) => (
              <div className={styles.media} key={field}>
                <strong>{field === "logoMediaId" ? "لوگوی فروشگاه" : "آیکون مرورگر"}</strong>
                {business[field] && (
                  <Image
                    src={`/api/media/${business[field]}/file?variant=small`}
                    alt="پیش‌نمایش تصویر انتخاب‌شده"
                    width={64}
                    height={64}
                    unoptimized
                  />
                )}
                <button type="button" onClick={() => setPicker(field)}>
                  انتخاب از کتابخانه
                </button>
                {business[field] && (
                  <button type="button" onClick={() => change({ ...business, [field]: null })}>
                    حذف انتخاب
                  </button>
                )}
              </div>
            ))}
          </>
        )}
        {kind === "contact" && (
          <>
            {input("تلفن بین‌المللی، مانند ‎+982112345678", "phone", contact.phone, {
              type: "tel",
              dir: "ltr",
              max: 20,
            })}
            {input("ایمیل", "email", contact.email, { type: "email", dir: "ltr", max: 254 })}
            <label className={styles.field}>
              <span>نشانی</span>
              <textarea
                value={contact.address}
                maxLength={500}
                onChange={(e) => change({ ...contact, address: e.target.value })}
              />
            </label>
            {input("نشانی اینستاگرام", "instagramUrl", contact.instagramUrl, {
              type: "url",
              dir: "ltr",
              max: 160,
            })}
            {input("نشانی تلگرام", "telegramUrl", contact.telegramUrl, {
              type: "url",
              dir: "ltr",
              max: 160,
            })}
            <label className={styles.field}>
              <span>نقشهٔ تأییدشده</span>
              <select
                value={contact.mapProvider}
                onChange={(e) =>
                  change({
                    ...contact,
                    mapProvider: e.target.value as "none" | "google",
                    latitude: null,
                    longitude: null,
                  })
                }
              >
                <option value="none">بدون نقشه</option>
                <option value="google">نقشهٔ گوگل با مختصات</option>
              </select>
            </label>
            {contact.mapProvider === "google" && (
              <>
                <label className={styles.field}>
                  <span>عرض جغرافیایی</span>
                  <input
                    type="number"
                    dir="ltr"
                    step="any"
                    min={-90}
                    max={90}
                    value={contact.latitude ?? ""}
                    onChange={(e) =>
                      change({
                        ...contact,
                        latitude: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>طول جغرافیایی</span>
                  <input
                    type="number"
                    dir="ltr"
                    step="any"
                    min={-180}
                    max={180}
                    value={contact.longitude ?? ""}
                    onChange={(e) =>
                      change({
                        ...contact,
                        longitude: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </>
            )}
            {settingsMapUrl(contact) && (
              <a href={settingsMapUrl(contact)!} target="_blank" rel="noopener noreferrer">
                پیش‌نمایش نقشه در تب جدید
              </a>
            )}
          </>
        )}
        {kind === "seo" && (
          <>
            {input("عنوان پیش‌فرض", "title", seo.title, { max: 100 })}
            <label className={styles.field}>
              <span>توضیح متا</span>
              <textarea
                value={seo.description}
                maxLength={320}
                onChange={(e) => change({ ...seo, description: e.target.value })}
              />
            </label>
            {input("الگوی عنوان؛ دقیقاً یک ‎%s", "titleTemplate", seo.titleTemplate, { max: 160 })}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={seo.indexable}
                onChange={(e) => change({ ...seo, indexable: e.target.checked })}
              />
              اجازهٔ نمایه‌سازی صفحات عمومی
            </label>
            <div className={styles.preview}>
              <strong>{seo.titleTemplate.replace("%s", seo.title)}</strong>
              <p>{seo.description || "توضیحی وارد نشده است."}</p>
              <small>پیش‌نمایش تقریبی نتیجهٔ جست‌وجو؛ تضمینی برای نمایش موتور جست‌وجو نیست.</small>
            </div>
          </>
        )}
        {kind === "printing" && (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={printing.enabled}
                onChange={(e) =>
                  change({
                    ...printing,
                    enabled: e.target.checked,
                    automaticPrint: e.target.checked ? printing.automaticPrint : false,
                  })
                }
              />
              چاپ فعال باشد
            </label>
            {input("شناسهٔ پل/چاپگر فعال", "bridgeId", printing.bridgeId, { dir: "ltr", max: 64 })}
            <label className={styles.field}>
              <span>عرض کاغذ</span>
              <select
                value={printing.paperWidthMm}
                onChange={(e) =>
                  change({ ...printing, paperWidthMm: Number(e.target.value) as 58 | 80 })
                }
              >
                <option value="58">۵۸ میلی‌متر</option>
                <option value="80">۸۰ میلی‌متر</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>تعداد نسخه</span>
              <input
                type="number"
                min={1}
                max={3}
                value={printing.copies}
                onChange={(e) => change({ ...printing, copies: Number(e.target.value) })}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={printing.automaticPrint}
                disabled={!printing.enabled}
                onChange={(e) => change({ ...printing, automaticPrint: e.target.checked })}
              />
              چاپ خودکار فاکتورهای جدید
            </label>
            <label className={styles.field}>
              <span>متن پایین رسید</span>
              <textarea
                value={printing.footer}
                maxLength={300}
                onChange={(e) => change({ ...printing, footer: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>رمز پل چاپ؛ خالی = بدون تغییر</span>
              <input
                type="password"
                autoComplete="new-password"
                value={bridgeToken}
                onChange={(e) => {
                  setBridgeToken(e.target.value);
                  key.current = null;
                }}
                minLength={16}
                maxLength={4096}
              />
              <small>
                {saved.credentials.configured
                  ? "رمز ذخیره شده است؛ مقدار قبلی هرگز نمایش داده نمی‌شود."
                  : "هنوز رمزی ذخیره نشده است."}
              </small>
            </label>
            <p>چاپ آزمایشی مرورگر هیچ سفارش یا پرداختی ایجاد نمی‌کند و در ممیزی ثبت می‌شود.</p>
            <TestPrintButton disabled={busy || dirty} />
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {status && (
          <p role="status" className={styles.success}>
            {status}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" disabled={busy || !dirty}>
            {busy ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}
          </button>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => {
              setDraft(saved.values as SettingsValues[EditableKind]);
              setBridgeToken("");
              key.current = null;
              setError("");
            }}
          >
            بازنشانی تغییرات
          </button>
          <button type="button" disabled={busy} onClick={reload}>
            بازخوانی نسخهٔ سرور
          </button>
        </div>
      </form>
      {picker && (
        <MediaPicker
          onClose={() => setPicker(null)}
          onSelect={(id) => {
            change({ ...business, [picker]: id });
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}

function TestPrintButton({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feedback = useFeedback();
  async function run() {
    if (
      !(await feedback.confirm({
        title: "ساخت برگهٔ آزمایشی؟",
        description: "این برگه اطلاعات سفارش یا پرداخت ندارد و درخواست آن در ممیزی ثبت می‌شود.",
        confirmLabel: "ساخت برگهٔ آزمایشی",
        dangerous: false,
      }))
    )
      return;
    setBusy(true);
    setError("");
    const tab = window.open("", "_blank");
    try {
      const response = await fetch("/api/admin/settings/printing/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      const result = (await response.json()) as { ok: boolean; value?: { url: string } };
      if (!response.ok || !result.ok || !result.value?.url) throw new Error();
      if (tab) tab.location.href = result.value.url;
      else setError("مرورگر پنجرهٔ چاپ را مسدود کرد. اجازهٔ پنجرهٔ جدید بدهید و دوباره تلاش کنید.");
    } catch {
      tab?.close();
      setError("برگهٔ آزمایشی ساخته نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" disabled={disabled || busy} onClick={run}>
        {busy ? "در حال آماده‌سازی…" : "چاپ آزمایشی مرورگر"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
