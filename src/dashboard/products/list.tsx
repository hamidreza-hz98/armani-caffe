"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProductSummary } from "@/modules/catalog/products";
import { formatJalaliDate, formatToman } from "@/theme/format";

import styles from "./products.module.css";

type Action = "publish" | "unpublish" | "archive";
const label: Record<ProductSummary["status"], string> = {
  draft: "پیش‌نویس",
  published: "منتشرشده",
  archived: "بایگانی‌شده",
};

export function ProductList({
  products,
  categories,
  editable,
}: {
  products: readonly ProductSummary[];
  categories: readonly { id: string; name: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const toggle = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  async function bulk(action: Action) {
    const targets = products.filter(
      (product) =>
        selected.includes(product.id) &&
        product.status !== "archived" &&
        (action === "archive" ||
          (action === "publish" && product.status === "draft") ||
          (action === "unpublish" && product.status === "published")),
    );
    if (!targets.length) {
      setMessage("محصول واجد شرایطی برای این عملیات انتخاب نشده است.");
      return;
    }
    if (
      action === "archive" &&
      !window.confirm(
        `بایگانی ${targets.length.toLocaleString("fa-IR")} محصول؟ این کار انتشار آن‌ها را متوقف می‌کند.`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    let completed = 0;
    try {
      for (const product of targets) {
        try {
          const response = await fetch(`/api/products/${product.id}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: product.revision }),
          });
          const result = await response.json();
          if (response.ok && result.ok) completed++;
        } catch {
          /* A failed item must not prevent the remaining selected items. */
        }
      }
      setMessage(
        `${completed.toLocaleString("fa-IR")} از ${targets.length.toLocaleString("fa-IR")} محصول به‌روزرسانی شد.${completed < targets.length ? " موارد ناموفق را دوباره بررسی کنید." : ""}`,
      );
      setSelected([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!products.length)
    return (
      <section className={styles.empty}>
        <h2>محصولی پیدا نشد</h2>
        <p>فیلترها را تغییر دهید یا محصول تازه‌ای بسازید.</p>
        {editable && <Link href="/dashboard/products/new">ساخت محصول</Link>}
      </section>
    );
  const image = (product: ProductSummary) =>
    product.mediaIds[0] ? (
      <Image
        src={`/api/media/${product.mediaIds[0]}/file?variant=small`}
        alt={`تصویر ${product.name}`}
        width={48}
        height={48}
        unoptimized
        className={styles.thumb}
      />
    ) : (
      <span className={styles.thumbPlaceholder} aria-hidden="true">
        ☕
      </span>
    );
  return (
    <section className={styles.results} aria-label="فهرست محصولات">
      {editable && selected.length > 0 && (
        <div className={styles.bulkBar}>
          <span>{selected.length.toLocaleString("fa-IR")} محصول انتخاب شده</span>
          <div>
            <button type="button" disabled={busy} onClick={() => bulk("publish")}>
              انتشار
            </button>
            <button type="button" disabled={busy} onClick={() => bulk("unpublish")}>
              پیش‌نویس
            </button>
            <button type="button" disabled={busy} onClick={() => bulk("archive")}>
              بایگانی
            </button>
            <button type="button" disabled={busy} onClick={() => setSelected([])}>
              لغو انتخاب
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      <div className={styles.desktopTable}>
        <table>
          <caption>محصولات این صفحه</caption>
          <thead>
            <tr>
              {editable && (
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="انتخاب همه محصولات صفحه"
                    checked={selected.length === products.length}
                    onChange={(event) =>
                      setSelected(event.target.checked ? products.map((product) => product.id) : [])
                    }
                  />
                </th>
              )}
              <th scope="col">محصول</th>
              <th scope="col">دسته‌بندی</th>
              <th scope="col">قیمت</th>
              <th scope="col">وضعیت</th>
              <th scope="col">سفارش‌پذیری</th>
              <th scope="col">آخرین ویرایش</th>
              <th scope="col">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                {editable && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`انتخاب ${product.name}`}
                      checked={selected.includes(product.id)}
                      onChange={() => toggle(product.id)}
                    />
                  </td>
                )}
                <th scope="row">
                  <div className={styles.productCell}>
                    {image(product)}
                    <span>
                      <strong>{product.name}</strong>
                      <small>{product.excerpt || product.slug}</small>
                    </span>
                  </div>
                </th>
                <td>{categoryNames.get(product.categoryId) ?? "—"}</td>
                <td>{formatToman(product.basePriceToman)}</td>
                <td>
                  <span className={`${styles.status} ${styles[product.status]}`}>
                    {label[product.status]}
                  </span>
                </td>
                <td>{product.available ? "فعال" : "غیرفعال"}</td>
                <td>{formatJalaliDate(product.updatedAt)}</td>
                <td>
                  <Link href={`/dashboard/products/${product.id}`}>
                    {editable ? "ویرایش" : "مشاهده"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.mobileCards}>
        {products.map((product) => (
          <article className={styles.mobileCard} key={product.id}>
            <div className={styles.mobileCardTop}>
              {editable && (
                <input
                  type="checkbox"
                  aria-label={`انتخاب ${product.name}`}
                  checked={selected.includes(product.id)}
                  onChange={() => toggle(product.id)}
                />
              )}
              {image(product)}
              <div>
                <h2>{product.name}</h2>
                <p>{categoryNames.get(product.categoryId) ?? "—"}</p>
              </div>
              <Link href={`/dashboard/products/${product.id}`}>
                {editable ? "ویرایش" : "مشاهده"}
              </Link>
            </div>
            <p className={styles.mobileExcerpt}>{product.excerpt || "بدون توضیح کوتاه"}</p>
            <div className={styles.mobileMeta}>
              <strong>{formatToman(product.basePriceToman)}</strong>
              <span className={`${styles.status} ${styles[product.status]}`}>
                {label[product.status]}
              </span>
              <span>{product.available ? "سفارش‌پذیر" : "غیرفعال"}</span>
            </div>
            <small>ویرایش: {formatJalaliDate(product.updatedAt)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
