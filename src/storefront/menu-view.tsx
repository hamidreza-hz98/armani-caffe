import Image from "next/image";
import Link from "next/link";

import { formatPersianNumber, formatToman } from "@/theme/format";

import { CartControl } from "./cart-control";
import { CategoryTabs } from "./category-tabs";
import styles from "./menu.module.css";
import { MenuCartProvider } from "./menu-cart";
import { categoryAnchor, type MenuCardCategory } from "./menu-model";

export function MenuSkeleton() {
  return (
    <section className={styles.menu} aria-busy="true" aria-label="در حال بارگذاری منو">
      <noscript>
        <p className={styles.noScript}>
          برای مشاهدهٔ منو بدون جاوااسکریپت، <a href="/menu/basic">نسخهٔ سادهٔ منو</a> را باز کنید.
        </p>
      </noscript>
      <div className={styles.intro}>
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLineShort} />
      </div>
      <div className={styles.skeletonTabs}>
        <span />
        <span />
        <span />
      </div>
      {[0, 1, 2].map((index) => (
        <div className={styles.skeletonRow} key={index}>
          <span className={styles.skeletonImage} />
          <span className={styles.skeletonLines}>
            <i />
            <i />
            <i />
          </span>
        </div>
      ))}
    </section>
  );
}

export function MenuFailure() {
  return (
    <section className={styles.menu}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>منوی آنلاین</p>
        <h1>آرمانی کافه</h1>
      </div>
      <div className={styles.stateCard} role="alert">
        <h2>دریافت منو ممکن نشد</h2>
        <p>
          اتصال به فهرست محصولات برقرار نیست. لطفاً دوباره تلاش کنید یا از بخش ارتباط با ما راه‌های
          تماس را ببینید.
        </p>
        <Link href="/" className={styles.retryLink}>
          تلاش دوباره
        </Link>
      </div>
    </section>
  );
}

export function MenuView({
  categories,
  initialGuest = false,
}: {
  categories: readonly MenuCardCategory[];
  initialGuest?: boolean;
}) {
  const productCount = categories.reduce((total, category) => total + category.products.length, 0);
  return (
    <MenuCartProvider initialGuest={initialGuest}>
      <div className={styles.menu}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>منوی آنلاین</p>
          <h1>آرمانی کافه</h1>
          <p>نوشیدنی و خوراکی دلخواهتان را پیدا کنید.</p>
        </div>
        {productCount === 0 ? (
          <div className={styles.stateCard}>
            <h2>منو فعلاً خالی است</h2>
            <p>محصولی برای سفارش آنلاین منتشر نشده است. کمی بعد دوباره سر بزنید.</p>
          </div>
        ) : (
          <>
            <CategoryTabs categories={categories.map(({ id, name }) => ({ id, name }))} />
            <div className={styles.sections}>
              {categories.map((category, categoryIndex) => (
                <section
                  id={categoryAnchor(category.id)}
                  className={styles.category}
                  key={category.id}
                  aria-labelledby={`${categoryAnchor(category.id)}-title`}
                >
                  <div className={styles.categoryHeading}>
                    <h2 id={`${categoryAnchor(category.id)}-title`}>{category.name}</h2>
                    <span>{formatPersianNumber(category.products.length)} محصول</span>
                  </div>
                  {category.products.length ? (
                    <div className={styles.productList}>
                      {category.products.map((product, productIndex) => (
                        <article className={styles.product} key={product.id}>
                          <div className={styles.productImage}>
                            {product.imageId ? (
                              <Image
                                src={`/api/media/${product.imageId}/file?variant=small`}
                                alt={`تصویر ${product.name}`}
                                width={88}
                                height={88}
                                sizes="88px"
                                priority={categoryIndex === 0 && productIndex === 0}
                                unoptimized
                              />
                            ) : (
                              <Image
                                src="/icon.svg"
                                alt="تصویر محصول موجود نیست"
                                width={40}
                                height={40}
                              />
                            )}
                          </div>
                          <div className={styles.productBody}>
                            <h3>{product.name}</h3>
                            {product.description && (
                              <p className={styles.description}>{product.description}</p>
                            )}
                            {product.hasAdditions && (
                              <span className={styles.additions}>افزودنی اختیاری دارد</span>
                            )}
                            <div className={styles.productBottom}>
                              <span className={styles.price}>
                                {formatToman(product.priceToman)}
                              </span>
                              <CartControl
                                productId={product.id}
                                orderable={product.orderable}
                                hasAdditions={product.hasAdditions}
                              />
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.categoryEmpty}>محصولی در این دسته منتشر نشده است.</p>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
        <noscript>
          <p className={styles.noScript}>
            منو و قیمت‌ها بدون جاوااسکریپت قابل مشاهده‌اند؛ برای افزودن به سبد، جاوااسکریپت را فعال
            کنید.
          </p>
        </noscript>
      </div>
    </MenuCartProvider>
  );
}
