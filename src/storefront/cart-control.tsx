"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CartView } from "@/modules/carts";

import styles from "./menu.module.css";

type Result =
  { ok: true; value: CartView } | { ok: false; error: { code: string; message: string } };

export function CartControl({ productId, orderable }: { productId: string; orderable: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "added" | "auth" | "error">("idle");
  async function add() {
    if (!orderable || state === "busy") return;
    setState("busy");
    try {
      const read = await fetch("/api/customer/cart", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (read.status === 401) {
        setState("auth");
        return;
      }
      const current = (await read.json()) as Result;
      if (!read.ok || !current.ok) throw new Error("Cart unavailable");
      const response = await fetch("/api/customer/cart", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "add",
          cartId: current.value.id,
          revision: current.value.revision,
          productId,
          additionIds: [],
          quantity: 1,
        }),
      });
      const result = (await response.json()) as Result;
      if (!response.ok || !result.ok) throw new Error("Cart update failed");
      setState("added");
      router.refresh();
    } catch {
      setState("error");
    }
  }
  if (!orderable)
    return (
      <span className={styles.unavailable} aria-label="این محصول ناموجود است">
        ناموجود
      </span>
    );
  return (
    <div className={styles.cartAction}>
      <button type="button" className={styles.addButton} disabled={state === "busy"} onClick={add}>
        {state === "busy" ? "در حال افزودن…" : state === "added" ? "افزوده شد" : "+ افزودن"}
      </button>
      {state === "auth" && (
        <span className={styles.actionNote} role="status">
          برای افزودن، <Link href="/account">وارد شوید</Link>.
        </span>
      )}
      {state === "error" && (
        <span className={styles.actionNote} role="alert">
          سبد در دسترس نیست؛ دوباره تلاش کنید.
        </span>
      )}
    </div>
  );
}
