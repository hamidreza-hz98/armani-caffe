"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import styles from "./products.module.css";

type Asset = { id: string; title: string; altText: string; status: string };
export function MediaPicker({
  onSelect,
  onClose,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Asset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
          pageSize: "20",
          status: "ready",
          visibility: "public",
        });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/media?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error("Media read failed");
        setItems(body.value.items);
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
  }, [query]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="media-picker-title"
      className={styles.modal}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.rowHeading}>
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
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {loading ? (
        <p>در حال بارگذاری…</p>
      ) : error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setQuery(query + " ")}>
            تلاش دوباره
          </button>
        </p>
      ) : items.length ? (
        <div className={styles.mediaGrid}>
          {items.map((item) => (
            <button type="button" key={item.id} onClick={() => onSelect(item.id)}>
              <Image
                src={`/api/media/${item.id}/file?variant=small`}
                alt={item.altText || item.title}
                width={110}
                height={110}
                unoptimized
              />
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <p>تصویری پیدا نشد. ابتدا از بخش رسانه‌ها تصویر بارگذاری کنید.</p>
      )}
    </dialog>
  );
}
