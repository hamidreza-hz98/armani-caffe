"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProductDetail } from "@/modules/catalog/products";
import { useFeedback } from "@/theme/feedback-provider";
import { formatToman } from "@/theme/format";
import { useUnsavedChanges } from "@/theme/unsaved-changes";

import { BasicFields } from "./editor-basic";
import { ProductMediaFields } from "./editor-media";
import type { ProductFormFields } from "./form-types";
import styles from "./products.module.css";

const AdditionsEditor = dynamic(
  () => import("./editor-additions").then((module) => module.AdditionsEditor),
  { ssr: false, loading: () => <p>در حال بارگذاری افزودنی‌ها…</p> },
);
const RulesEditor = dynamic(() => import("./editor-rules").then((module) => module.RulesEditor), {
  ssr: false,
  loading: () => <p>در حال بارگذاری انبار…</p>,
});
const MediaPicker = dynamic(() => import("../media/picker").then((module) => module.MediaPicker), {
  ssr: false,
});

type Result =
  { ok: true; value: ProductDetail } | { ok: false; error: { code: string; message: string } };
const fromProduct = (product: ProductDetail | null): ProductFormFields => ({
  name: product?.name ?? "",
  categoryId: product?.categoryId ?? "",
  basePriceToman: product?.basePriceToman ?? 0,
  description: product?.description ?? "",
  excerpt: product?.excerpt ?? "",
  ingredients: product?.ingredients ?? "",
  mediaIds: [...(product?.mediaIds ?? [])],
  available: product?.available ?? true,
  sortOrder: product?.sortOrder ?? 0,
  additions:
    product?.additions.map((addition) => ({
      id: addition.id,
      name: addition.name,
      priceToman: addition.priceToman,
      available: addition.available,
      mediaId: addition.mediaId,
    })) ?? [],
  consumptionRules: product?.consumptionRules.map((rule) => ({ ...rule })) ?? [],
});

export function ProductEditor({
  actor,
  product,
  categories,
  inventory,
}: {
  actor: { role: "OWNER" | "CASHIER" };
  product: ProductDetail | null;
  categories: readonly { id: string; name: string; status: string }[];
  inventory: readonly { id: string; name: string; unit: "gram" | "milliliter" | "piece" }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormFields>(() => fromProduct(product));
  const [saved, setSaved] = useState<ProductFormFields>(() => fromProduct(product));
  const [revision, setRevision] = useState(product?.revision ?? 0);
  const [status, setStatus] = useState(product?.status ?? "draft");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [picker, setPicker] = useState<{ kind: "product" | "addition"; index?: number } | null>(
    null,
  );
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const feedback = useFeedback();
  const allowDiscard = useUnsavedChanges(dirty);
  const editable = actor.role === "OWNER" && status !== "archived";
  const update = <K extends keyof ProductFormFields>(key: K, value: ProductFormFields[K]) =>
    setForm((prior) => ({ ...prior, [key]: value }));

  async function request(
    url: string,
    method: "POST" | "PATCH",
    body: unknown,
  ): Promise<ProductDetail | null> {
    setBusy(true);
    setNotice("");
    setConflict(false);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as Result;
      if (!response.ok || !result.ok) {
        if (!result.ok && result.error.code === "CONFLICT") setConflict(true);
        setNotice(!result.ok ? result.error.message : "ثبت محصول ممکن نشد.");
        return null;
      }
      return result.value;
    } catch {
      setNotice("ارتباط برقرار نشد. دوباره تلاش کنید.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  function accept(value: ProductDetail) {
    const next = fromProduct(value);
    setForm(next);
    setSaved(next);
    setRevision(value.revision);
    setStatus(value.status);
    router.refresh();
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || busy) return;
    if (
      !form.name.trim() ||
      !form.categoryId ||
      !Number.isSafeInteger(form.basePriceToman) ||
      form.basePriceToman < 0
    ) {
      setNotice("نام، دسته‌بندی و قیمت معتبر لازم است.");
      return;
    }
    const value = await request(
      product ? `/api/products/${product.id}` : "/api/products",
      product ? "PATCH" : "POST",
      product ? { ...form, revision } : form,
    );
    if (!value) return;
    accept(value);
    setNotice("تغییرات ذخیره شد.");
    if (!product) router.replace(`/dashboard/products/${value.id}`);
  }
  async function transition(action: "publish" | "unpublish" | "archive") {
    if (!product || !editable || busy) return;
    if (dirty) {
      setNotice("ابتدا تغییرات فرم را ذخیره کنید.");
      return;
    }
    if (
      action === "publish" &&
      (!form.excerpt.trim() || form.basePriceToman <= 0 || !form.mediaIds.length)
    ) {
      setNotice("برای انتشار، توضیح کوتاه، قیمت مثبت و تصویر لازم است.");
      return;
    }
    if (
      action === "archive" &&
      !(await feedback.confirm({
        title: "بایگانی محصول؟",
        description: "محصول از منوی عمومی حذف می‌شود؛ سوابق سفارش‌های پیشین تغییر نمی‌کنند.",
        confirmLabel: "بایگانی محصول",
        dangerous: true,
      }))
    )
      return;
    const value = await request(`/api/products/${product.id}/${action}`, "POST", { revision });
    if (value) {
      accept(value);
      setNotice(
        action === "publish"
          ? "محصول منتشر شد."
          : action === "archive"
            ? "محصول بایگانی شد."
            : "محصول به پیش‌نویس برگشت.",
      );
    }
  }
  function selectMedia(id: string) {
    if (picker?.kind === "product")
      update("mediaIds", form.mediaIds.includes(id) ? form.mediaIds : [...form.mediaIds, id]);
    if (picker?.kind === "addition" && picker.index !== undefined)
      update(
        "additions",
        form.additions.map((addition, index) =>
          index === picker.index ? { ...addition, mediaId: id } : addition,
        ),
      );
    setPicker(null);
  }
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>
            <Link href="/dashboard/products">محصولات</Link> /{" "}
            {product ? "جزئیات محصول" : "محصول جدید"}
          </p>
          <h1>{product ? `ویرایش ${product.name}` : "محصول جدید"}</h1>
          <p>
            {product
              ? `وضعیت: ${status === "published" ? "منتشرشده" : status === "archived" ? "بایگانی‌شده" : "پیش‌نویس"} · ویرایش ${revision.toLocaleString("fa-IR")}`
              : "ابتدا یک پیش‌نویس بسازید؛ سپس آن را منتشر کنید."}
          </p>
        </div>
        <Link className={styles.secondary} href="/dashboard/products">
          بازگشت به فهرست
        </Link>
      </header>
      {actor.role === "CASHIER" && (
        <p className={styles.notice}>این صفحه برای نقش صندوق‌دار فقط خواندنی است.</p>
      )}
      {notice && (
        <p role="alert" className={styles.notice}>
          {notice}{" "}
          {conflict && (
            <button
              type="button"
              onClick={() => {
                allowDiscard();
                window.location.reload();
              }}
            >
              بارگذاری نسخه جدید
            </button>
          )}
        </p>
      )}
      <form onSubmit={save} className={styles.editorForm}>
        <fieldset disabled={!editable || busy} className={styles.fieldset}>
          <BasicFields form={form} categories={categories} update={update} />
          <ProductMediaFields
            mediaIds={form.mediaIds}
            update={update}
            onPick={() => setPicker({ kind: "product" })}
          />
          <section className={styles.editorSection}>
            <h2>افزودنی‌ها</h2>
            <p>ترتیب افزودنی‌ها با دکمه‌های جابه‌جایی مشخص می‌شود.</p>
            <AdditionsEditor
              value={form.additions}
              onChange={(value) => update("additions", value)}
              onPickMedia={(index) => setPicker({ kind: "addition", index })}
            />
          </section>
          <section className={styles.editorSection}>
            <h2>مصرف انبار برای هر فروش</h2>
            <p>فقط واحد سازگار با قلم انبار پذیرفته می‌شود.</p>
            <RulesEditor
              value={form.consumptionRules}
              inventory={inventory}
              onChange={(value) => update("consumptionRules", value)}
            />
          </section>
        </fieldset>
        <div className={styles.stickyActions}>
          <span>
            {dirty
              ? "تغییرات ذخیره نشده"
              : product
                ? `قیمت پایه: ${formatToman(form.basePriceToman)}`
                : "پیش‌نویس جدید"}
          </span>
          <div>
            {editable && (
              <>
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={busy || (!dirty && !!product)}
                >
                  {busy ? "در حال ثبت…" : "ذخیره تغییرات"}
                </button>
                {product && status === "draft" && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy || dirty}
                    onClick={() => transition("publish")}
                  >
                    انتشار
                  </button>
                )}
                {product && status === "published" && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy || dirty}
                    onClick={() => transition("unpublish")}
                  >
                    بازگشت به پیش‌نویس
                  </button>
                )}
                {product && (
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={busy || dirty}
                    onClick={() => transition("archive")}
                  >
                    بایگانی
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </form>
      {picker && <MediaPicker onSelect={selectMedia} onClose={() => setPicker(null)} />}
    </div>
  );
}
