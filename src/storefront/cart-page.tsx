"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cartItemKey, type CartItemSnapshot, type CartView } from "@/modules/carts";
import { formatPersianNumber, formatToman } from "@/theme/format";

import styles from "./cart-checkout.module.css";
import { CartLineControl } from "./cart-line-control";
import { openCustomerAuth } from "./customer-auth-events";
import { MenuCartProvider, useMenuCart } from "./menu-cart";
import {
  checkoutIdempotencyKey,
  composePickupNotes,
  parsePickupNotes,
  type PickupChoice,
} from "./pickup-notes";

type CustomerSummary = { displayName: string | null; phone: string } | null;
type CheckoutResult = {
  checkout: { id: string; state: string; totalToman: number };
  payment: { amountToman: number; status: string; redirectUrl: string | null } | null;
};
type ApiResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
type Attempt = { cartId: string; revision: number; totalToman: number; key: string };

function issueText(code: string): string {
  const messages: Record<string, string> = {
    PRODUCT_UNAVAILABLE: "این محصول دیگر قابل سفارش نیست. آن را از سبد حذف کنید.",
    ADDITION_UNAVAILABLE: "یکی از افزودنی‌ها دیگر موجود نیست. انتخاب را از منو تغییر دهید.",
    INSUFFICIENT_STOCK: "موجودی این محصول کافی نیست. تعداد را کم کنید یا محصول را حذف کنید.",
    PRICE_CHANGED: "قیمت این محصول تغییر کرده است. مبلغ جدید را بررسی کنید.",
    CART_EXPIRED: "اعتبار سبد تمام شده است. سبد را دوباره بارگذاری کنید.",
  };
  return messages[code] ?? "این مورد نیاز به بررسی دوباره دارد.";
}

function ProductNote({ item }: { item: CartItemSnapshot }) {
  const [note, setNote] = useState(item.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { dispatch } = useMenuCart();
  const key = cartItemKey(
    item.productId,
    item.additions.map((addition) => addition.additionId),
  );
  async function save() {
    if (saving || note === item.note) return;
    setSaving(true);
    setError("");
    try {
      await dispatch({ type: "change", itemKey: key, quantity: item.quantity, note });
    } catch {
      setError("یادداشت ثبت نشد. دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={styles.productNote}>
      <label htmlFor={`note-${key}`}>یادداشت این محصول</label>
      <textarea
        id={`note-${key}`}
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="button" disabled={saving || note === item.note} onClick={() => void save()}>
        {saving ? "در حال ثبت…" : "ثبت یادداشت"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

function CartContent({
  productImages,
  customer,
}: {
  productImages: Record<string, string>;
  customer: CustomerSummary;
}) {
  const { cart, status, reload, preview, dispatch, busy } = useMenuCart();
  const [choice, setChoice] = useState<PickupChoice>("asap");
  const [orderNote, setOrderNote] = useState("");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const initializedCart = useRef<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);

  useEffect(() => {
    if (!cart?.id || initializedCart.current === cart.id) return;
    initializedCart.current = cart.id;
    const parsed = parsePickupNotes(cart.notes);
    setChoice(parsed.choice);
    setOrderNote(parsed.customerNote);
  }, [cart]);

  async function savePreferences(current: CartView): Promise<CartView> {
    const notes = composePickupNotes(choice, orderNote);
    if (notes.length > 1000) throw new Error("یادداشت سفارش بیش از حد طولانی است.");
    if (current.notes === notes) return current;
    return dispatch({ type: "notes", notes });
  }

  async function recalculate() {
    if (!cart?.id || checking || submitting || busy) return;
    setChecking(true);
    setError("");
    attempt.current = null;
    try {
      const saved = await savePreferences(cart);
      const current = await preview();
      setNotice(
        current.issues.length
          ? "قیمت و موجودی به‌روز شد. موارد زیر را بررسی و دوباره محاسبه کنید."
          : saved.notes !== cart.notes
            ? "انتخاب تحویل و قیمت‌های فعلی ثبت و بررسی شد."
            : "قیمت و موجودی فعلی بررسی شد.",
      );
    } catch {
      setError("بررسی سبد انجام نشد. اتصال را بررسی و دوباره تلاش کنید.");
      await reload();
    } finally {
      setChecking(false);
    }
  }

  async function checkout() {
    if (!cart?.id || inFlight.current || busy || checking || !cart.items.length) return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      let currentAttempt = attempt.current;
      if (!currentAttempt) {
        await savePreferences(cart);
        const current = await preview();
        if (current.issues.length || !current.checkoutReady) {
          setNotice("قیمت یا موجودی تغییر کرده است. سبد را بررسی و دوباره محاسبه کنید.");
          return;
        }
        currentAttempt = {
          cartId: current.id,
          revision: current.revision,
          totalToman: current.pricing.totalToman,
          key: checkoutIdempotencyKey(current.id, current.revision),
        };
        attempt.current = currentAttempt;
      }
      const response = await fetch("/api/checkout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": currentAttempt.key },
        body: JSON.stringify({
          cartId: currentAttempt.cartId,
          revision: currentAttempt.revision,
          idempotencyKey: currentAttempt.key,
        }),
      });
      const result = (await response.json()) as ApiResult<CheckoutResult>;
      if (!response.ok || !result.ok) {
        if (!result.ok && result.error.code === "CONFLICT") {
          attempt.current = null;
          await reload();
          setError("سبد تغییر کرده است. قیمت و موجودی را دوباره بررسی کنید.");
        } else setError("شروع پرداخت انجام نشد. می‌توانید بدون ثبت سفارش تکراری دوباره تلاش کنید.");
        return;
      }
      const { checkout: intent, payment } = result.value;
      if (
        intent.state !== "PAYMENT_PENDING" ||
        intent.totalToman !== currentAttempt.totalToman ||
        !payment ||
        payment.amountToman !== currentAttempt.totalToman ||
        payment.status !== "pending" ||
        !payment.redirectUrl
      ) {
        setError("وضعیت پرداخت نامشخص است. بدون ساخت سفارش جدید، دوباره تلاش کنید.");
        return;
      }
      const destination = new URL(payment.redirectUrl);
      if (
        !["http:", "https:"].includes(destination.protocol) ||
        destination.username ||
        destination.password
      )
        throw new Error("Unsafe payment URL");
      window.history.replaceState(null, "", `/payment/result/${intent.id}`);
      window.location.assign(destination.href);
    } catch {
      setError("اتصال به درگاه برقرار نشد. بدون ثبت سفارش تکراری دوباره تلاش کنید.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (status === "loading")
    return (
      <section className={styles.page} aria-busy="true">
        <h1>سبد خرید</h1>
        <p role="status">در حال بارگذاری سبد…</p>
      </section>
    );
  if (status === "guest")
    return (
      <section className={styles.page}>
        <h1>سبد خرید</h1>
        <div className={styles.state}>
          <p>برای مشاهده سبد و ادامه سفارش وارد حساب خود شوید.</p>
          <button type="button" onClick={() => openCustomerAuth()}>
            ورود یا ثبت‌نام
          </button>
        </div>
      </section>
    );
  if (status === "error")
    return (
      <section className={styles.page}>
        <h1>سبد خرید</h1>
        <div className={styles.state} role="alert">
          <p>سبد خرید در دسترس نیست.</p>
          <button type="button" onClick={() => void reload()}>
            تلاش دوباره
          </button>
        </div>
      </section>
    );
  if (!cart?.items.length)
    return (
      <section className={styles.page}>
        <h1>سبد خرید</h1>
        <div className={styles.state}>
          <span aria-hidden="true">♧</span>
          <h2>سبد خرید شما خالی است</h2>
          <p>از منو یک نوشیدنی یا خوراکی انتخاب کنید.</p>
          <Link href="/">بازگشت به منو</Link>
        </div>
      </section>
    );

  const dirty = cart.notes !== composePickupNotes(choice, orderNote);
  const hasBlockingIssue = cart.issues.some((issue) => issue.code !== "PRICE_CHANGED");
  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <Link href="/" aria-label="بازگشت به منو">
          ←
        </Link>
        <div>
          <h1>سبد خرید</h1>
          <small>
            {formatPersianNumber(cart.items.reduce((sum, item) => sum + item.quantity, 0))} قلم در
            سبد
          </small>
        </div>
      </div>
      {cart.issues.length > 0 && (
        <div className={styles.issueBanner} role="alert">
          <strong>
            {hasBlockingIssue ? "برخی اقلام نیاز به اصلاح دارند" : "قیمت‌ها به‌روز شده‌اند"}
          </strong>
          <p>مبلغ و موجودی را بررسی کنید. تا رفع موارد زیر پرداخت آغاز نمی‌شود.</p>
        </div>
      )}
      <div className={styles.lines}>
        {cart.items.map((item) => {
          const key = cartItemKey(
            item.productId,
            item.additions.map((addition) => addition.additionId),
          );
          const itemIssues = cart.issues.filter((issue) => issue.itemKey === key);
          const imageId = productImages[item.productId];
          return (
            <article
              key={key}
              className={`${styles.line} ${itemIssues.length ? styles.lineIssue : ""}`}
            >
              <div className={styles.lineTop}>
                <div className={styles.image}>
                  {imageId ? (
                    <Image
                      src={`/api/media/${imageId}/file?variant=small`}
                      alt={`تصویر ${item.productName}`}
                      width={84}
                      height={84}
                      sizes="84px"
                      unoptimized
                    />
                  ) : (
                    <Image
                      src="/armani-icon.svg"
                      alt="تصویر محصول موجود نیست"
                      width={40}
                      height={40}
                    />
                  )}
                </div>
                <div className={styles.lineInfo}>
                  <h2>{item.productName}</h2>
                  <strong>{formatToman(item.lineTotalToman)}</strong>
                  <small>قیمت هر واحد: {formatToman(item.unitPriceToman)}</small>
                </div>
              </div>
              {item.additions.length > 0 && (
                <ul className={styles.additions}>
                  {item.additions.map((addition) => (
                    <li key={addition.additionId}>
                      {addition.name} · {formatToman(addition.priceToman)}
                    </li>
                  ))}
                </ul>
              )}
              {itemIssues.map((issue, index) => (
                <p key={`${issue.code}-${index}`} className={styles.itemIssue} role="status">
                  {issueText(issue.code)}
                  {issue.code === "PRICE_CHANGED" && issue.previousUnitPriceToman !== undefined
                    ? ` (${formatToman(issue.previousUnitPriceToman)} ← ${formatToman(issue.currentUnitPriceToman ?? item.unitPriceToman)})`
                    : ""}
                </p>
              ))}
              <CartLineControl item={item} showRemove />
              <ProductNote key={`${key}-${item.note}`} item={item} />
            </article>
          );
        })}
      </div>
      <section className={styles.card} aria-labelledby="customer-summary-title">
        <h2 id="customer-summary-title">اطلاعات مشتری</h2>
        <p>{customer?.displayName || "مشتری کافه آرمانی"}</p>
        <bdi dir="ltr">{customer?.phone ?? "شماره حساب شما هنگام پرداخت بررسی می‌شود"}</bdi>
      </section>
      <section className={styles.card} aria-labelledby="pickup-title">
        <h2 id="pickup-title">روش دریافت</h2>
        <p className={styles.pickupOnly}>تحویل حضوری در کافه</p>
        <fieldset className={styles.pickupChoices}>
          <legend>زمان درخواستی تحویل</legend>
          {(["asap", "30", "60"] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="pickup-time"
                value={value}
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                  attempt.current = null;
                }}
              />
              {value === "asap"
                ? "در اولین فرصت"
                : value === "30"
                  ? "حدود ۳۰ دقیقه پس از ثبت سفارش"
                  : "حدود ۶۰ دقیقه پس از ثبت سفارش"}
            </label>
          ))}
        </fieldset>
        <small>زمان انتخابی درخواست شماست و پس از ثبت سفارش توسط کافه بررسی می‌شود.</small>
      </section>
      <section className={styles.card} aria-labelledby="order-note-title">
        <h2 id="order-note-title">توضیحات سفارش</h2>
        <label htmlFor="order-note">یادداشت برای کافه (اختیاری)</label>
        <textarea
          id="order-note"
          maxLength={850}
          value={orderNote}
          onChange={(event) => {
            setOrderNote(event.target.value);
            attempt.current = null;
          }}
          placeholder="مثلاً زمان مراجعه یا توضیح کلی سفارش"
        />
        <button
          type="button"
          disabled={!dirty || busy || checking || submitting}
          onClick={() =>
            void savePreferences(cart).catch(() => setError("ثبت تنظیمات تحویل انجام نشد."))
          }
        >
          ثبت انتخاب تحویل و یادداشت
        </button>
        {dirty && <small role="status">تغییرات این بخش هنوز روی سرور ثبت نشده‌اند.</small>}
      </section>
      <section className={styles.card} aria-labelledby="price-title">
        <h2 id="price-title">خلاصه پرداخت</h2>
        <dl className={styles.prices}>
          <div>
            <dt>جمع کالاها</dt>
            <dd>{formatToman(cart.pricing.subtotalToman)}</dd>
          </div>
          <div>
            <dt>تخفیف</dt>
            <dd>{formatToman(cart.pricing.discountToman)}</dd>
          </div>
          <div>
            <dt>هزینه تحویل حضوری</dt>
            <dd>{formatToman(cart.pricing.deliveryToman)}</dd>
          </div>
          <div className={styles.total}>
            <dt>مبلغ قابل پرداخت</dt>
            <dd>{formatToman(cart.pricing.totalToman)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className={styles.recheck}
          disabled={busy || checking || submitting}
          onClick={() => void recalculate()}
        >
          {checking ? "در حال محاسبه مجدد…" : "بررسی مجدد قیمت و موجودی"}
        </button>
      </section>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <strong>پرداخت آغاز نشد</strong>
          <p>{error}</p>
        </div>
      )}
      <div className={styles.bottom}>
        <div>
          <small>مبلغ قابل پرداخت</small>
          <strong>{formatToman(cart.pricing.totalToman)}</strong>
        </div>
        <button
          type="button"
          disabled={busy || checking || submitting || hasBlockingIssue || cart.issues.length > 0}
          onClick={() => void checkout()}
        >
          {submitting ? "در حال اتصال به پرداخت…" : "ثبت سفارش و ادامه پرداخت"}
        </button>
        <small>مبلغ نهایی پیش از انتقال، از سرور بررسی می‌شود.</small>
      </div>
    </section>
  );
}

export function CartPageClient({
  productImages = {},
  customer = null,
}: {
  productImages?: Record<string, string>;
  customer?: CustomerSummary;
}) {
  return (
    <MenuCartProvider summary={false}>
      <CartContent productImages={productImages} customer={customer} />
    </MenuCartProvider>
  );
}
