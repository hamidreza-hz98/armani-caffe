"use client";

import { useMemo, useRef, useState } from "react";

import { inventoryRequest } from "./api";
import { useInventoryDialogFocus } from "./dialog-focus";
import styles from "./inventory.module.css";
import type { InventoryItem, StockMovement, StockRequest } from "./model";
import { allUnitLabels, compatibleUnits, requestLabels, unitLabels } from "./model";

type Kind = StockRequest["kind"];
const quantityKinds: Kind[] = ["initial", "purchase", "adjustment", "waste"];
function proposedDelta(quantity: string, unit: string, base: InventoryItem["unit"], kind: Kind) {
  const value = Number(quantity);
  const multiplier = unit === "kilogram" || unit === "liter" ? 1000 : 1;
  const result = value * multiplier;
  if (!compatibleUnits[base].includes(unit) || !Number.isSafeInteger(result) || result === 0)
    return null;
  if ((kind === "initial" || kind === "purchase") && result < 0) return null;
  if (kind === "waste" && result > 0) return null;
  return result;
}
export function ChangeDialog({
  item,
  isOwner,
  movements,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  isOwner: boolean;
  movements: StockMovement[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("purchase");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<string>(item.unit);
  const [reason, setReason] = useState("");
  const [reversalOf, setReversalOf] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  useInventoryDialogFocus(dialogRef, true, onClose);
  const key = useRef(crypto.randomUUID());
  const original = movements.find((row) => row.id === reversalOf);
  const delta = useMemo(
    () =>
      kind === "reversal"
        ? original
          ? -original.delta
          : null
        : proposedDelta(quantity, unit, item.unit, kind),
    [kind, original, quantity, unit, item.unit],
  );
  const next = delta === null ? null : item.onHand + delta;
  async function submit() {
    if (busy || delta === null || next === null || next < 0 || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await inventoryRequest<StockRequest>("/api/inventory/requests", "POST", {
        inventoryItemId: item.id,
        kind,
        ...(kind === "reversal" ? { reversalOf } : { quantity, unit }),
        reason: reason.trim(),
        idempotencyKey: `dashboard:${key.current}`,
      });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "درخواست ثبت نشد.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={styles.modalBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-change-title"
      >
        <h2 id="stock-change-title">درخواست تغییر موجودی: {item.name}</h2>
        <p className={styles.hint}>
          ثبت درخواست، موجودی تأییدشده را تغییر نمی‌دهد. تأیید مدیر لازم است.
        </p>
        <label>
          نوع تغییر
          <select
            autoFocus
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as Kind);
              setConfirming(false);
            }}
          >
            {quantityKinds
              .filter((value) => isOwner || value !== "initial")
              .map((value) => (
                <option key={value} value={value}>
                  {requestLabels[value]}
                </option>
              ))}
            {isOwner && <option value="reversal">{requestLabels.reversal}</option>}
          </select>
        </label>
        {kind === "reversal" ? (
          <label>
            حرکت برای برگشت
            <select value={reversalOf} onChange={(event) => setReversalOf(event.target.value)}>
              <option value="">انتخاب حرکت</option>
              {movements
                .filter(
                  (row) =>
                    row.reason !== "initial" &&
                    row.reason !== "reversal" &&
                    !movements.some((other) => other.reversalOf === row.id),
                )
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.reason} — {row.delta > 0 ? "+" : ""}
                    {row.delta} {unitLabels[item.unit]}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <div className={styles.twoColumns}>
            <label>
              مقدار
              <input
                required
                type="number"
                step="any"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setConfirming(false);
                }}
                placeholder={kind === "waste" ? "مثلاً ‎-۲" : "مثلاً ۲"}
              />
            </label>
            <label>
              واحد
              <select
                value={unit}
                onChange={(event) => {
                  setUnit(event.target.value);
                  setConfirming(false);
                }}
              >
                {compatibleUnits[item.unit].map((value) => (
                  <option key={value} value={value}>
                    {allUnitLabels[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label>
          دلیل
          <input
            required
            maxLength={1000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setConfirming(false);
            }}
            placeholder="دلیل مستند تغییر موجودی"
          />
        </label>
        <div className={styles.balancePreview}>
          <span>
            موجودی تأییدشده: {item.onHand.toLocaleString("fa-IR")} {unitLabels[item.unit]}
          </span>
          <span>
            پس از تأیید:{" "}
            {next === null ? "—" : `${next.toLocaleString("fa-IR")} ${unitLabels[item.unit]}`}
          </span>
        </div>
        {next !== null && next < 0 && (
          <p role="alert" className={styles.error}>
            موجودی نمی‌تواند منفی شود.
          </p>
        )}
        {delta === null && (quantity || reversalOf) && (
          <p role="alert" className={styles.error}>
            مقدار یا واحد معتبر نیست.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {confirming && (
          <p role="status" className={styles.warning}>
            درخواست {requestLabels[kind]} برای {item.name} با تغییر {delta?.toLocaleString("fa-IR")}{" "}
            {unitLabels[item.unit]} ثبت شود؟
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || delta === null || next === null || next < 0 || !reason.trim()}
            onClick={() => (confirming ? void submit() : setConfirming(true))}
          >
            {busy ? "در حال ثبت…" : confirming ? "تأیید و ثبت درخواست" : "بررسی و ادامه"}
          </button>
        </div>
      </section>
    </div>
  );
}
