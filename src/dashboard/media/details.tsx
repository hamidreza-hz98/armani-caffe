"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { MediaDetail, MediaMetadata, MediaUsage } from "@/modules/media";
import { useFeedback } from "@/theme/feedback-provider";

import { mediaDetail, mediaKey, mediaRequest, mediaUsages } from "./api";
import styles from "./media.module.css";
import { MediaPicker } from "./picker";

export function MediaDetails({
  id,
  owner,
  onClose,
  onChanged,
}: {
  id: string;
  owner: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [usages, setUsages] = useState<MediaUsage[]>([]);
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const feedback = useFeedback();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([mediaDetail(id), owner ? mediaUsages(id) : Promise.resolve([])])
      .then(([asset, refs]) => {
        if (!live) return;
        setDetail(asset);
        setUsages(refs);
        setMetadata({
          title: asset.title,
          altText: asset.altText,
          caption: asset.caption,
          visibility: asset.visibility as "public" | "private",
          seo: asset.seo,
        });
        setError("");
      })
      .catch(() => {
        if (live) setError("دریافت جزئیات ممکن نشد.");
      });
    return () => {
      live = false;
    };
  }, [id, owner, attempt]);
  const update = (patch: Partial<MediaMetadata>) =>
    setMetadata((current) => current && { ...current, ...patch });
  async function save() {
    if (!detail || !metadata) return;
    setBusy(true);
    setError("");
    try {
      const updated = await mediaRequest<MediaDetail>(
        `/api/media/${id}`,
        "PATCH",
        { revision: detail.revision, metadata },
        mediaKey(),
      );
      setDetail(updated);
      setNotice("تغییرات ذخیره شد.");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    const element = dialog.current;
    element?.close();
    if (
      !(await feedback.confirm({
        title: "حذف همیشگی رسانه؟",
        description:
          "این فایل و همهٔ نسخه‌های بهینه‌شدهٔ آن حذف می‌شوند. رسانهٔ در حال استفاده قابل حذف نیست.",
        confirmLabel: "حذف برای همیشه",
        dangerous: true,
        requiredText: "حذف",
      }))
    ) {
      element?.showModal();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await mediaRequest(`/api/media/${id}`, "DELETE", {}, mediaKey());
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حذف انجام نشد.");
      element?.showModal();
    } finally {
      setBusy(false);
    }
  }
  async function replace(targetId: string) {
    setPicker(false);
    setBusy(true);
    setError("");
    try {
      await mediaRequest(`/api/media/${id}/replace`, "POST", { targetId }, mediaKey());
      setNotice("ارجاع‌ها به تصویر جدید منتقل شدند.");
      setAttempt((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "جایگزینی انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <dialog
        ref={dialog}
        aria-labelledby="media-detail-title"
        className={styles.drawer}
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className={styles.row}>
          <h2 id="media-detail-title">جزئیات رسانه</h2>
          <button type="button" onClick={onClose} aria-label="بستن جزئیات">
            ×
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}{" "}
            {!detail && (
              <button type="button" onClick={() => setAttempt(attempt + 1)}>
                تلاش دوباره
              </button>
            )}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!detail || !metadata ? (
          !error && <p role="status">در حال بارگذاری…</p>
        ) : (
          <div className={styles.detailContent}>
            {detail.status === "ready" && (
              <Image
                className={styles.preview}
                src={`/api/media/${id}/file?variant=large`}
                alt={detail.altText || detail.title}
                width={520}
                height={320}
                unoptimized
              />
            )}
            <dl className={styles.facts}>
              <div>
                <dt>نوع</dt>
                <dd>{detail.mimeType}</dd>
              </div>
              <div>
                <dt>اندازه</dt>
                <dd>{detail.byteSize.toLocaleString("fa-IR")} بایت</dd>
              </div>
              <div>
                <dt>ابعاد</dt>
                <dd>
                  {detail.width ?? "—"} × {detail.height ?? "—"}
                </dd>
              </div>
              <div>
                <dt>وضعیت</dt>
                <dd>{detail.status}</dd>
              </div>
            </dl>
            {owner ? (
              <>
                <label>
                  عنوان
                  <input
                    maxLength={120}
                    value={metadata.title}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </label>
                <label>
                  متن جایگزین تصویر
                  <input
                    maxLength={200}
                    value={metadata.altText}
                    onChange={(event) => update({ altText: event.target.value })}
                  />
                </label>
                <label>
                  توضیح
                  <textarea
                    maxLength={500}
                    value={metadata.caption}
                    onChange={(event) => update({ caption: event.target.value })}
                  />
                </label>
                <label>
                  نمایش
                  <select
                    value={metadata.visibility}
                    onChange={(event) =>
                      update({ visibility: event.target.value as "private" | "public" })
                    }
                  >
                    <option value="public">عمومی</option>
                    <option value="private">خصوصی</option>
                  </select>
                </label>
                <details>
                  <summary>اطلاعات SEO</summary>
                  <label>
                    عنوان SEO
                    <input
                      maxLength={150}
                      value={metadata.seo.title}
                      onChange={(event) =>
                        update({ seo: { ...metadata.seo, title: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    توضیح SEO
                    <textarea
                      maxLength={300}
                      value={metadata.seo.description}
                      onChange={(event) =>
                        update({ seo: { ...metadata.seo, description: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    کلیدواژه‌ها (با ویرگول جدا کنید)
                    <input
                      value={metadata.seo.keywords.join(", ")}
                      onChange={(event) =>
                        update({
                          seo: {
                            ...metadata.seo,
                            keywords: event.target.value
                              .split(",")
                              .map((word) => word.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                    />
                  </label>
                </details>
                <button type="button" className={styles.primary} disabled={busy} onClick={save}>
                  ذخیره اطلاعات
                </button>
                <section className={styles.references}>
                  <h3>موارد استفاده ({usages.length.toLocaleString("fa-IR")})</h3>
                  {usages.length ? (
                    <ul>
                      {usages.map((usage) => (
                        <li key={`${usage.entityKind}-${usage.entityId}-${usage.field}`}>
                          {usage.entityKind === "product" ? "محصول" : "دسته‌بندی"} ·{" "}
                          <bdi>{usage.entityId}</bdi>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>این رسانه در محصول یا دسته‌بندی استفاده نشده است.</p>
                  )}
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy || !usages.length}
                      onClick={() => setPicker(true)}
                    >
                      جایگزینی ارجاع‌ها
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy || usages.length > 0}
                      onClick={remove}
                    >
                      حذف رسانه
                    </button>
                  </div>
                  {usages.length > 0 && <p>برای حذف، ابتدا ارجاع‌ها را جایگزین کنید.</p>}
                </section>
              </>
            ) : (
              <p>{detail.caption}</p>
            )}
          </div>
        )}
      </dialog>
      {picker && <MediaPicker excludeId={id} onSelect={replace} onClose={() => setPicker(false)} />}
    </>
  );
}
