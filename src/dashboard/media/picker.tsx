"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { MediaSummary } from "@/modules/media";

import { type MediaPage, mediaRequest } from "./api";
import styles from "./media.module.css";

export function MediaPicker({
  onSelect,
  onClose,
  excludeId,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
  excludeId?: string;
}) {
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "20",
          status: "ready",
          visibility: "public",
        });
        if (query.trim()) params.set("q", query.trim());
        const response = await mediaRequest<MediaPage>(`/api/media?${params}`);
        if (!controller.signal.aborted) {
          setItems(response.items);
          setTotal(response.total);
        }
      } catch {
        if (!controller.signal.aborted) setError("بارگذاری تصاویر ممکن نشد.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, page, attempt]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="media-picker-title"
      className={styles.picker}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.row}>
        <h2 id="media-picker-title">انتخاب تصویر</h2>
        <button type="button" onClick={onClose} aria-label="بستن انتخاب تصویر">
          ×
        </button>
      </div>
      <label>
        جستجوی رسانه
        <input
          ref={input}
          type="search"
          value={query}
          maxLength={80}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {loading ? (
        <p role="status">در حال بارگذاری…</p>
      ) : error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            تلاش دوباره
          </button>
        </p>
      ) : items.length ? (
        <div className={styles.pickerGrid}>
          {items
            .filter((item) => item.id !== excludeId)
            .map((item) => (
              <button type="button" key={item.id} onClick={() => onSelect(item.id)}>
                <Image
                  src={`/api/media/${item.id}/file?variant=small`}
                  alt=""
                  width={110}
                  height={110}
                  unoptimized
                />
                <span>{item.title}</span>
              </button>
            ))}
        </div>
      ) : (
        <p>
          تصویری پیدا نشد. <Link href="/dashboard/media/upload">بارگذاری تصویر</Link>
        </p>
      )}
      <div className={styles.row}>
        <span>صفحه {page.toLocaleString("fa-IR")}</span>
        <div>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            قبلی
          </button>
          <button type="button" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
            بعدی
          </button>
        </div>
      </div>
    </dialog>
  );
}
