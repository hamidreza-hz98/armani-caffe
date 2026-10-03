import type { Metadata } from "next";
import Link from "next/link";

import { MediaBrowser } from "@/dashboard/media/browser";
import styles from "@/dashboard/media/media.module.css";
import { mediaListData } from "@/dashboard/media/server";

export const metadata: Metadata = { title: "کتابخانه رسانه" };

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor, result, params } = await mediaListData(await searchParams);
  const page = result.page;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (next: number) => {
    const query = new URLSearchParams(params);
    query.set("page", String(next));
    return `/dashboard/media?${query}`;
  };
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>دارایی‌های بصری کافه</p>
          <h1>کتابخانه رسانه</h1>
          <p>{result.total.toLocaleString("fa-IR")} فایل در این نمای فیلترشده</p>
        </div>
        {actor.role === "OWNER" && (
          <Link className={styles.primary} href="/dashboard/media/upload">
            + بارگذاری تصویر
          </Link>
        )}
      </header>
      <form
        className={styles.filters}
        action="/dashboard/media"
        method="get"
        aria-label="فیلتر رسانه‌ها"
      >
        <label>
          جستجو
          <input
            name="q"
            type="search"
            maxLength={80}
            defaultValue={params.get("q") ?? ""}
            placeholder="نام، عنوان یا متن جایگزین"
          />
        </label>
        <label>
          نوع فایل
          <select name="mimeType" defaultValue={params.get("mimeType") ?? ""}>
            <option value="">همه تصاویر</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
            <option value="image/webp">WebP</option>
          </select>
        </label>
        {actor.role === "OWNER" && (
          <>
            <label>
              نمایش
              <select name="visibility" defaultValue={params.get("visibility") ?? ""}>
                <option value="">همه</option>
                <option value="public">عمومی</option>
                <option value="private">خصوصی</option>
              </select>
            </label>
            <label>
              وضعیت
              <select name="status" defaultValue={params.get("status") ?? ""}>
                <option value="">آماده</option>
                <option value="pending">در انتظار تکمیل</option>
                <option value="rejected">ناموفق</option>
              </select>
            </label>
          </>
        )}
        <label>
          ترتیب
          <select name="sort" defaultValue={params.get("sort") ?? "createdAt"}>
            <option value="createdAt">تاریخ ایجاد</option>
            <option value="updatedAt">آخرین ویرایش</option>
            <option value="title">عنوان</option>
            <option value="byteSize">اندازه</option>
          </select>
        </label>
        <button type="submit" className={styles.secondary}>
          اعمال
        </button>
        <Link href="/dashboard/media" className={styles.textLink}>
          پاک‌کردن
        </Link>
      </form>
      <MediaBrowser items={result.items} owner={actor.role === "OWNER"} />
      <nav className={styles.pagination} aria-label="صفحه‌بندی رسانه">
        <span>
          صفحه {page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}
        </span>
        <div>
          {page > 1 && <Link href={href(page - 1)}>صفحه قبل</Link>}
          {page < pages && <Link href={href(page + 1)}>صفحه بعد</Link>}
        </div>
      </nav>
    </div>
  );
}
