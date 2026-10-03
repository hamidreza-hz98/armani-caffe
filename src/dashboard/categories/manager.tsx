"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { Category } from "@/modules/catalog/categories";

import { type CategoryList, categoryList, categoryRequest, CategoryRequestError } from "./api";
import styles from "./categories.module.css";
import { CategoryDeleteDialog } from "./delete-dialog";
import { CategoryEditor } from "./editor";

export function CategoryManager({
  initial,
  counts,
  editable,
  q,
  status,
}: {
  initial: CategoryList;
  counts: Record<string, number>;
  editable: boolean;
  q: string;
  status: "all" | "draft" | "published";
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(initial);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dragId = useRef<string | null>(null);
  const touchId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const filtered = !!q.trim() || status !== "all";
  const visible = confirmed.items.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      (!q.trim() ||
        `${item.name} ${item.slug}`
          .toLocaleLowerCase("fa-IR")
          .includes(q.trim().toLocaleLowerCase("fa-IR"))),
  );
  const activeCount = confirmed.items.filter((item) => item.status === "published").length;
  async function reload() {
    const latest = await categoryList();
    setConfirmed(latest);
    router.refresh();
  }
  async function reorder(source: string, target: string) {
    if (!editable || filtered || source === target || busyRef.current) return;
    const ids = confirmed.items.map((item) => item.id);
    const from = ids.indexOf(source),
      to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("در حال ذخیره ترتیب جدید…");
    try {
      const next = await categoryRequest<CategoryList>("/api/categories/reorder", "POST", {
        revision: confirmed.orderRevision,
        ids,
      });
      setConfirmed(next);
      setMessage("ترتیب ذخیره شد و منوی عمومی تازه شد.");
      router.refresh();
    } catch (cause) {
      setMessage("");
      setError(cause instanceof CategoryRequestError ? cause.message : "ترتیب ذخیره نشد.");
      if (cause instanceof CategoryRequestError && cause.code === "CONFLICT") {
        try {
          await reload();
        } catch {
          /* confirmed order remains visible */
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function saved(message: string) {
    setEditing(null);
    setMessage(message);
    setError("");
    try {
      await reload();
    } catch {
      setError("تغییر ذخیره شد اما فهرست تازه نشد. صفحه را بازخوانی کنید.");
    }
  }
  async function remove() {
    if (!deleting || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await categoryRequest(`/api/categories/${deleting.id}`, "DELETE", {
        revision: deleting.revision,
      });
      setDeleting(null);
      setMessage("دسته‌بندی حذف شد و منوی عمومی تازه شد.");
      try {
        await reload();
      } catch {
        setError("حذف انجام شد اما فهرست تازه نشد. صفحه را بازخوانی کنید.");
      }
    } catch (cause) {
      setError(cause instanceof CategoryRequestError ? cause.message : "حذف انجام نشد.");
      if (cause instanceof CategoryRequestError && cause.code === "CONFLICT") {
        try {
          await reload();
        } catch {
          /* retained */
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function touchDrop(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" || !touchId.current) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-category-id]")?.dataset.categoryId;
    const source = touchId.current;
    touchId.current = null;
    if (target) void reorder(source, target);
  }
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>مدیریت منو</p>
          <h1>دسته‌بندی‌ها</h1>
          <p>ترتیب و وضعیت نمایش دسته‌های منوی کافه</p>
        </div>
        {editable && (
          <button className={styles.primary} type="button" onClick={() => setEditing("new")}>
            + دسته‌بندی جدید
          </button>
        )}
      </header>
      <div className={styles.stats}>
        <div>
          <span>همه دسته‌ها</span>
          <strong>{confirmed.items.length.toLocaleString("fa-IR")}</strong>
        </div>
        <div>
          <span>فعال در منو</span>
          <strong>{activeCount.toLocaleString("fa-IR")}</strong>
        </div>
        <div>
          <span>غیرفعال</span>
          <strong>{(confirmed.items.length - activeCount).toLocaleString("fa-IR")}</strong>
        </div>
      </div>
      <form
        className={styles.filters}
        action="/dashboard/categories"
        method="get"
        aria-label="فیلتر دسته‌بندی‌ها"
      >
        <label>
          جستجو
          <input
            name="q"
            type="search"
            maxLength={80}
            defaultValue={q}
            placeholder="نام یا نشانی دسته‌بندی"
          />
        </label>
        <label>
          وضعیت
          <select name="status" defaultValue={status}>
            <option value="all">همه</option>
            <option value="published">فعال</option>
            <option value="draft">غیرفعال</option>
          </select>
        </label>
        <button type="submit" className={styles.secondary}>
          اعمال فیلتر
        </button>
        <Link href="/dashboard/categories">پاک‌کردن</Link>
      </form>
      {filtered && (
        <p className={styles.hint}>
          برای تغییر ترتیب، فیلترها را پاک کنید تا همه دسته‌بندی‌ها دیده شوند.
        </p>
      )}
      {!filtered && editable && (
        <p className={styles.hint}>
          دسته‌بندی‌ها را با دستگیره بکشید، یا با دکمه‌های بالا/پایین جابه‌جا کنید. ترتیب فقط پس از
          پاسخ سرور تغییر می‌کند.
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              void reload().catch(() => setError("بازخوانی انجام نشد."));
            }}
          >
            بازخوانی
          </button>
        </p>
      )}
      {!visible.length ? (
        <div className={styles.empty}>
          <h2>دسته‌بندی‌ای پیدا نشد</h2>
          <p>فیلترها را تغییر دهید یا دسته‌بندی تازه بسازید.</p>
        </div>
      ) : (
        <ol className={styles.list} aria-label="ترتیب دسته‌بندی‌ها">
          {visible.map((item, index) => (
            <li
              key={item.id}
              className={styles.item}
              data-category-id={item.id}
              onDragOver={(event) => {
                if (dragId.current) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId.current) void reorder(dragId.current, item.id);
                dragId.current = null;
              }}
            >
              {editable && !filtered && (
                <div className={styles.reorder}>
                  <button
                    type="button"
                    className={styles.handle}
                    aria-label={`کشیدن ${item.name} برای جابه‌جایی`}
                    draggable={!busy}
                    onDragStart={(event) => {
                      dragId.current = item.id;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragEnd={() => {
                      dragId.current = null;
                    }}
                    onPointerDown={(event) => {
                      if (event.pointerType !== "mouse") touchId.current = item.id;
                    }}
                    onPointerUp={touchDrop}
                    style={{ touchAction: "none" }}
                  >
                    ⠿
                  </button>
                  <div>
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      aria-label={`انتقال ${item.name} به بالا`}
                      onClick={() => void reorder(item.id, confirmed.items[index - 1].id)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === confirmed.items.length - 1}
                      aria-label={`انتقال ${item.name} به پایین`}
                      onClick={() => void reorder(item.id, confirmed.items[index + 1].id)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              )}
              <span className={styles.order}>{(item.sortOrder + 1).toLocaleString("fa-IR")}</span>
              <div className={styles.image}>
                {item.mediaId ? (
                  <Image
                    src={`/api/media/${item.mediaId}/file?variant=small`}
                    width={72}
                    height={72}
                    alt=""
                    unoptimized
                  />
                ) : (
                  <span aria-label="بدون تصویر">◇</span>
                )}
              </div>
              <div className={styles.description}>
                <h2>{item.name}</h2>
                <p>
                  <bdi>{item.slug}</bdi>
                </p>
              </div>
              <div className={styles.count}>
                {(counts[item.id] ?? 0).toLocaleString("fa-IR")} محصول
              </div>
              <span className={item.status === "published" ? styles.active : styles.inactive}>
                {item.status === "published" ? "فعال" : "غیرفعال"}
              </span>
              <time dateTime={item.updatedAt}>
                {new Date(item.updatedAt).toLocaleDateString("fa-IR")}
              </time>
              {editable && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(item)}
                    aria-label={`ویرایش ${item.name}`}
                  >
                    ویرایش
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(item);
                      setError("");
                    }}
                    aria-label={`حذف ${item.name}`}
                  >
                    حذف
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className={styles.footerNote}>
        تغییرات موفق دسته‌بندی در منوی عمومی اعمال می‌شوند.{" "}
        <Link href="/" target="_blank" rel="noopener noreferrer">
          مشاهده منو
        </Link>
      </p>
      {editing && (
        <CategoryEditor
          key={editing === "new" ? "new" : editing.id}
          category={editing === "new" ? null : editing}
          productCount={editing === "new" ? 0 : (counts[editing.id] ?? 0)}
          onClose={() => setEditing(null)}
          onSaved={(value) => void saved(value)}
        />
      )}
      {deleting && (
        <CategoryDeleteDialog
          category={deleting}
          productCount={counts[deleting.id] ?? 0}
          busy={busy}
          error={error}
          onClose={() => setDeleting(null)}
          onDelete={() => void remove()}
        />
      )}
    </div>
  );
}
