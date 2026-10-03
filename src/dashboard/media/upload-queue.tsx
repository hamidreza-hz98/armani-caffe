"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { MediaDetail, MediaMetadata } from "@/modules/media";

import { mediaKey, mediaRequest } from "./api";
import styles from "./media.module.css";

type Status = "queued" | "starting" | "uploading" | "finalizing" | "done" | "failed" | "cancelled";
type Entry = {
  key: string;
  file: File;
  title: string;
  altText: string;
  visibility: "public" | "private";
  status: Status;
  progress: number;
  id?: string;
  uploaded?: boolean;
  invalid?: boolean;
  error?: string;
  initiationKey: string;
};
type Ticket = {
  id: string;
  status: string;
  upload: { url: string; fields: Record<string, string>; expiresIn: number } | null;
};
const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const pendingKey = "armani-media-pending-v1";

function directUpload(
  ticket: NonNullable<Ticket["upload"]>,
  file: File,
  progress: (value: number) => void,
  setXhr: (xhr: XMLHttpRequest | null) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    setXhr(xhr);
    xhr.open("POST", ticket.url);
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("ارتباط با فضای ذخیره‌سازی قطع شد."));
    xhr.ontimeout = () => reject(new Error("زمان بارگذاری به پایان رسید. دوباره تلاش کنید."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`بارگذاری مستقیم ناموفق بود (${xhr.status}).`));
    const data = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) data.append(name, value);
    data.append("file", file);
    xhr.send(data);
  }).finally(() => setXhr(null));
}

export function UploadQueue() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const cancelled = useRef(new Set<string>());
  const runningRef = useRef(false);
  useEffect(() => {
    const active = xhrs.current;
    return () => {
      for (const xhr of active.values()) xhr.abort();
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? "[]");
        if (Array.isArray(value))
          setPending(
            value.filter((id): id is string => typeof id === "string" && /^[a-f0-9]{24}$/.test(id)),
          );
      } catch {
        /* malformed browser state is ignored */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const remember = (id: string) =>
    setPending((current) => {
      const next = [...new Set([...current, id])];
      sessionStorage.setItem(pendingKey, JSON.stringify(next));
      return next;
    });
  const forget = (id: string) =>
    setPending((current) => {
      const next = current.filter((value) => value !== id);
      sessionStorage.setItem(pendingKey, JSON.stringify(next));
      return next;
    });
  const patch = (key: string, values: Partial<Entry>) =>
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...values } : entry)),
    );
  function addFiles(files: FileList | File[]) {
    setEntries((current) => {
      const seen = new Set(
        current.map(
          (entry) =>
            `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}:${entry.file.type}`,
        ),
      );
      const added: Entry[] = [];
      for (const file of Array.from(files)) {
        const signature = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        if (seen.has(signature)) {
          setNotice("فایل تکراری در صف نادیده گرفته شد.");
          continue;
        }
        seen.add(signature);
        const error = !supported.has(file.type)
          ? "فقط JPEG، PNG و WebP پذیرفته می‌شود."
          : file.size < 1 || file.size > MAX_BYTES
            ? "اندازه فایل باید بین ۱ بایت و ۱۰ مگابایت باشد."
            : file.name.length > 180 || /[\\/<>]/.test(file.name)
              ? "نام فایل نامعتبر است."
              : undefined;
        added.push({
          key: mediaKey(),
          file,
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
          altText: "",
          visibility: "public",
          status: error ? "failed" : "queued",
          invalid: !!error,
          progress: 0,
          error,
          initiationKey: mediaKey(),
        });
      }
      return [...current, ...added];
    });
  }
  async function runEntry(entry: Entry) {
    const metadata: MediaMetadata = {
      title: entry.title.trim(),
      altText: entry.altText.trim(),
      caption: "",
      visibility: entry.visibility,
      seo: { title: "", description: "", keywords: [] },
    };
    try {
      if (!metadata.title) throw new Error("عنوان تصویر لازم است.");
      cancelled.current.delete(entry.key);
      let id = entry.id;
      if (!entry.uploaded) {
        patch(entry.key, { status: "starting", error: "" });
        const ticket = await mediaRequest<Ticket>(
          "/api/media",
          "POST",
          {
            filename: entry.file.name,
            mimeType: entry.file.type,
            byteSize: entry.file.size,
            metadata,
          },
          entry.initiationKey,
        );
        id = ticket.id;
        patch(entry.key, { id });
        if (cancelled.current.has(entry.key)) return;
        if (ticket.status !== "ready") {
          if (!ticket.upload) throw new Error("مجوز بارگذاری صادر نشد.");
          patch(entry.key, { status: "uploading" });
          await directUpload(
            ticket.upload,
            entry.file,
            (progress) => patch(entry.key, { progress }),
            (xhr) => {
              if (xhr) xhrs.current.set(entry.key, xhr);
              else xhrs.current.delete(entry.key);
            },
          );
          remember(id);
          patch(entry.key, { uploaded: true });
        }
      }
      if (!id) throw new Error("شناسه رسانه دریافت نشد.");
      if (cancelled.current.has(entry.key)) return;
      patch(entry.key, { status: "finalizing", progress: 100 });
      await mediaRequest<MediaDetail>(`/api/media/${id}/complete`, "POST", {});
      forget(id);
      patch(entry.key, { status: "done", error: "" });
    } catch (cause) {
      if (cancelled.current.has(entry.key)) patch(entry.key, { status: "cancelled" });
      else
        patch(entry.key, {
          status: "failed",
          error: cause instanceof Error ? cause.message : "بارگذاری ناموفق بود.",
        });
    }
  }
  async function uploadAll() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const queue = entries.filter(
      (entry) => !entry.invalid && (entry.status === "queued" || entry.status === "failed"),
    );
    let index = 0;
    async function worker() {
      while (index < queue.length) {
        const entry = queue[index++];
        await runEntry(entry);
      }
    }
    await Promise.all([worker(), worker()]);
    runningRef.current = false;
    setRunning(false);
  }
  function cancel(entry: Entry) {
    cancelled.current.add(entry.key);
    xhrs.current.get(entry.key)?.abort();
    patch(entry.key, { status: "cancelled" });
  }
  async function recover(id: string) {
    try {
      await mediaRequest(`/api/media/${id}/complete`, "POST", {});
      forget(id);
      setNotice("بارگذاری پیشین تکمیل شد.");
    } catch {
      setNotice("تکمیل هنوز ممکن نیست؛ پس از بررسی اتصال دوباره تلاش کنید.");
    }
  }
  const finished = entries.filter((entry) => entry.status === "done").length;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>افزودن تصاویر به کتابخانه</p>
          <h1>بارگذاری رسانه</h1>
          <p>تصاویر مستقیم به فضای ذخیره‌سازی خصوصی فرستاده و سپس تأیید می‌شوند.</p>
        </div>
        <Link className={styles.secondary} href="/dashboard/media">
          بازگشت به کتابخانه
        </Link>
      </header>
      <div className={styles.uploadLayout}>
        <div>
          <div
            className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
          >
            <span aria-hidden="true">↑</span>
            <h2>تصاویر را اینجا رها کنید</h2>
            <p>JPEG، PNG یا WebP؛ حداکثر ۱۰ مگابایت برای هر تصویر</p>
            <button type="button" className={styles.primary} onClick={() => input.current?.click()}>
              انتخاب فایل‌ها
            </button>
            <input
              ref={input}
              className={styles.srOnly}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {pending.length > 0 && (
            <section className={styles.recovery}>
              <h2>بارگذاری‌های قابل بازیابی</h2>
              <p>فایل‌هایی که آپلود مستقیمشان تمام شده اما تأیید نهایی نشده است.</p>
              {pending.map((id) => (
                <div className={styles.row} key={id}>
                  <bdi>{id}</bdi>
                  <button type="button" onClick={() => recover(id)}>
                    تلاش برای تکمیل
                  </button>
                </div>
              ))}
            </section>
          )}
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          <section className={styles.queue}>
            <div className={styles.row}>
              <h2>صف بارگذاری ({entries.length.toLocaleString("fa-IR")})</h2>
              <button
                type="button"
                className={styles.primary}
                disabled={
                  running ||
                  !entries.some(
                    (entry) =>
                      !entry.invalid && (entry.status === "queued" || entry.status === "failed"),
                  )
                }
                onClick={uploadAll}
              >
                {running ? "در حال بارگذاری…" : "شروع بارگذاری"}
              </button>
            </div>
            {entries.length === 0 ? (
              <p>هنوز فایلی انتخاب نشده است.</p>
            ) : (
              entries.map((entry) => (
                <article className={styles.queueItem} key={entry.key}>
                  <div className={styles.row}>
                    <div>
                      <h3>
                        <bdi>{entry.file.name}</bdi>
                      </h3>
                      <p>
                        {(entry.file.size / 1024 / 1024).toLocaleString("fa-IR", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        مگابایت ·{" "}
                        {entry.status === "done"
                          ? "تکمیل‌شده"
                          : entry.status === "failed"
                            ? "ناموفق"
                            : entry.status === "cancelled"
                              ? "لغوشده"
                              : entry.status === "finalizing"
                                ? "در حال تأیید"
                                : entry.status === "uploading"
                                  ? "در حال انتقال"
                                  : "در صف"}
                      </p>
                    </div>
                    <div className={styles.row}>
                      {["starting", "uploading"].includes(entry.status) && (
                        <button type="button" onClick={() => cancel(entry)}>
                          لغو
                        </button>
                      )}
                      {(entry.status === "failed" || entry.status === "cancelled") &&
                        !entry.invalid && (
                          <button
                            type="button"
                            onClick={() => {
                              patch(entry.key, { status: "queued", error: "" });
                            }}
                          >
                            تلاش دوباره
                          </button>
                        )}
                    </div>
                  </div>
                  {entry.status !== "done" && (
                    <div className={styles.entryFields}>
                      <label>
                        عنوان
                        <input
                          maxLength={120}
                          disabled={entry.status !== "queued"}
                          value={entry.title}
                          onChange={(event) => patch(entry.key, { title: event.target.value })}
                        />
                      </label>
                      <label>
                        متن جایگزین
                        <input
                          maxLength={200}
                          disabled={entry.status !== "queued"}
                          value={entry.altText}
                          onChange={(event) => patch(entry.key, { altText: event.target.value })}
                        />
                      </label>
                      <label>
                        نمایش
                        <select
                          disabled={entry.status !== "queued"}
                          value={entry.visibility}
                          onChange={(event) =>
                            patch(entry.key, {
                              visibility: event.target.value as "public" | "private",
                            })
                          }
                        >
                          <option value="public">عمومی</option>
                          <option value="private">خصوصی</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <progress
                    max={100}
                    value={entry.progress}
                    aria-label={`پیشرفت بارگذاری ${entry.file.name}`}
                  />
                  <span>{entry.progress.toLocaleString("fa-IR")}٪</span>
                  {entry.error && (
                    <p role="alert" className={styles.error}>
                      {entry.error}
                    </p>
                  )}
                </article>
              ))
            )}
          </section>
        </div>
        <aside className={styles.uploadHelp}>
          <h2>پیش از بارگذاری</h2>
          <p>
            تصاویر به‌صورت خصوصی ذخیره می‌شوند و فقط پس از تأیید نهایی در کتابخانه نمایش داده
            می‌شوند. «عمومی» یعنی تصویر از مسیر کنترل‌شدهٔ سایت قابل نمایش است، نه اینکه مخزن عمومی
            باشد.
          </p>
          <p>
            متن جایگزین را برای تصاویر محتوایی بنویسید. برای تصاویر تزئینی می‌توانید آن را خالی
            بگذارید.
          </p>
          <strong>{finished.toLocaleString("fa-IR")} تصویر تکمیل‌شده</strong>
        </aside>
      </div>
    </div>
  );
}
