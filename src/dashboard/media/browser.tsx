"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MediaSummary } from "@/modules/media";
import { useFeedback } from "@/theme/feedback-provider";

import { mediaKey, mediaRequest } from "./api";
import { MediaDetails } from "./details";
import styles from "./media.module.css";

const formatSize = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
export function MediaBrowser({ items, owner }: { items: MediaSummary[]; owner: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const feedback = useFeedback();
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  async function removeSelected() {
    if (!selected.length) return;
    if (
      !(await feedback.confirm({
        title: "حذف رسانه‌های انتخاب‌شده؟",
        description: `${selected.length.toLocaleString("fa-IR")} رسانه حذف می‌شود؛ موارد در حال استفاده محافظت می‌شوند.`,
        confirmLabel: "حذف رسانه‌ها",
        dangerous: true,
      }))
    )
      return;
    setBusy(true);
    setMessage("");
    const outcomes = await Promise.allSettled(
      selected.map((id) => mediaRequest(`/api/media/${id}`, "DELETE", {}, mediaKey())),
    );
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    setMessage(
      failed
        ? `${failed.toLocaleString("fa-IR")} مورد حذف نشد؛ احتمالاً در حال استفاده است. جزئیات آن را بررسی کنید.`
        : "رسانه‌های انتخاب‌شده حذف شدند.",
    );
    setSelected([]);
    setBusy(false);
    router.refresh();
  }
  return (
    <>
      <div className={styles.toolbar}>
        <p>
          {selected.length
            ? `${selected.length.toLocaleString("fa-IR")} مورد انتخاب‌شده`
            : "برای مشاهده جزئیات، یک تصویر را باز کنید."}
        </p>
        <div className={styles.row}>
          {owner && selected.length > 0 && (
            <button
              type="button"
              disabled={busy}
              className={styles.danger}
              onClick={removeSelected}
            >
              حذف انتخاب‌شده‌ها
            </button>
          )}
          <div className={styles.segment} role="group" aria-label="شیوه نمایش">
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              شبکه‌ای
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
              فهرستی
            </button>
          </div>
        </div>
      </div>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {!items.length ? (
        <div className={styles.empty}>
          <h2>رسانه‌ای پیدا نشد</h2>
          <p>فیلترها را تغییر دهید یا تصویر تازه‌ای بارگذاری کنید.</p>
        </div>
      ) : (
        <div className={view === "grid" ? styles.grid : styles.list}>
          {items.map((item) => (
            <article key={item.id} className={styles.card}>
              <div className={styles.thumb}>
                {item.status === "ready" ? (
                  <Image
                    src={`/api/media/${item.id}/file?variant=small`}
                    alt=""
                    width={300}
                    height={210}
                    unoptimized
                  />
                ) : (
                  <span>تصویر در دسترس نیست</span>
                )}
                {owner && (
                  <label className={styles.select}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                      aria-label={`انتخاب ${item.title}`}
                    />
                  </label>
                )}
              </div>
              <div className={styles.cardBody}>
                <div>
                  <h2>{item.title}</h2>
                  <p>
                    {item.mimeType.replace("image/", "").toUpperCase()} ·{" "}
                    {formatSize(item.byteSize)}
                    {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                  </p>
                </div>
                <div className={styles.cardBottom}>
                  <span className={item.visibility === "public" ? styles.public : styles.private}>
                    {item.visibility === "public" ? "عمومی" : "خصوصی"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActive(item.id)}
                    aria-label={`جزئیات ${item.title}`}
                  >
                    جزئیات
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {active && (
        <MediaDetails
          id={active}
          owner={owner}
          onClose={() => setActive(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}
