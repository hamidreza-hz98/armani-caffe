import type { Metadata } from "next";
import Link from "next/link";

import { ProductList } from "@/dashboard/products/list";
import styles from "@/dashboard/products/products.module.css";
import { productListData } from "@/dashboard/products/server";
import { parseProductListQuery } from "@/modules/catalog/products";

export const metadata: Metadata = { title: "محصولات" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = parseProductListQuery(await searchParams);
  const { actor, products, categories } = await productListData(query);
  const pages = Math.max(1, Math.ceil(products.total / products.pageSize));
  const href = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.status !== "all") params.set("status", query.status);
    if (query.categoryId) params.set("category", query.categoryId);
    if (query.available !== "all") params.set("available", query.available);
    if (query.sort !== "newest") params.set("sort", query.sort);
    params.set("page", String(page));
    return `/dashboard/products?${params}`;
  };
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>مدیریت کاتالوگ</p>
          <h1>محصولات</h1>
          <p>فهرست محصولات، وضعیت انتشار و دسترس‌پذیری سفارش</p>
        </div>
        {actor.role === "OWNER" && (
          <Link className={styles.primary} href="/dashboard/products/new">
            + محصول جدید
          </Link>
        )}
      </header>
      <form
        className={styles.filters}
        method="get"
        action="/dashboard/products"
        aria-label="فیلتر محصولات"
      >
        <label>
          جستجو
          <input
            name="q"
            type="search"
            maxLength={80}
            defaultValue={query.q}
            placeholder="نام محصول"
          />
        </label>
        <label>
          وضعیت
          <select name="status" defaultValue={query.status}>
            <option value="all">همه وضعیت‌ها</option>
            <option value="draft">پیش‌نویس</option>
            <option value="published">منتشرشده</option>
            <option value="archived">بایگانی‌شده</option>
          </select>
        </label>
        <label>
          دسته‌بندی
          <select name="category" defaultValue={query.categoryId}>
            <option value="">همه دسته‌ها</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          سفارش‌پذیری
          <select name="available" defaultValue={query.available}>
            <option value="all">همه</option>
            <option value="yes">فعال</option>
            <option value="no">غیرفعال</option>
          </select>
        </label>
        <label>
          مرتب‌سازی
          <select name="sort" defaultValue={query.sort}>
            <option value="newest">تازه‌ترین ویرایش</option>
            <option value="name">نام</option>
            <option value="price">بیشترین قیمت</option>
          </select>
        </label>
        <button type="submit" className={styles.secondary}>
          اعمال فیلتر
        </button>
        <Link href="/dashboard/products" className={styles.reset}>
          پاک‌کردن
        </Link>
      </form>
      <ProductList
        products={products.items}
        categories={categories}
        editable={actor.role === "OWNER"}
      />
      <nav className={styles.pagination} aria-label="صفحه‌بندی محصولات">
        <span>
          {products.total.toLocaleString("fa-IR")} محصول · صفحه {query.page.toLocaleString("fa-IR")}{" "}
          از {pages.toLocaleString("fa-IR")}
        </span>
        <div>
          {query.page > 1 && <Link href={href(query.page - 1)}>صفحه قبل</Link>}
          {query.page < pages && <Link href={href(query.page + 1)}>صفحه بعد</Link>}
        </div>
      </nav>
    </div>
  );
}
