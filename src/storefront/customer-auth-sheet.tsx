"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { formatPersianNumber } from "@/theme/format";

import styles from "./customer-auth.module.css";
import {
  type AuthFieldErrors,
  type AuthFields,
  type AuthMode,
  AuthRequestError,
  customerAuthRequest,
  validateAuthFields,
} from "./customer-auth-client";
import { CUSTOMER_AUTHENTICATED, OPEN_CUSTOMER_AUTH } from "./customer-auth-events";

const emptyFields: AuthFields = {
  phone: "",
  password: "",
  displayName: "",
  birthYear: "",
  birthMonth: "",
  birthDay: "",
};
const months = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export function CustomerAuthSheet() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [fields, setFields] = useState<AuthFields>(emptyFields);
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [serverError, setServerError] = useState("");
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onOpen = (event: Event) => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setMode((event as CustomEvent<AuthMode>).detail === "signup" ? "signup" : "login");
      setFields(emptyFields);
      setErrors({});
      setServerError("");
      setVisible(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_CUSTOMER_AUTH, onOpen);
    return () => window.removeEventListener(OPEN_CUSTOMER_AUTH, onOpen);
  }, []);
  useEffect(() => {
    if (open) {
      if (!dialog.current?.open) dialog.current?.showModal();
      firstField.current?.focus();
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
    }
  }, [open, mode]);

  function close() {
    if (pending) return;
    setOpen(false);
    setFields(emptyFields);
    queueMicrotask(() => returnFocus.current?.focus());
  }
  function switchMode(next: AuthMode) {
    if (pending) return;
    setMode(next);
    setErrors({});
    setServerError("");
    setFields((current) => ({ ...current, password: "" }));
    setVisible(false);
  }
  function update(key: keyof AuthFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setServerError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = validateAuthFields(mode, fields);
    if (Object.keys(parsed.errors).length) {
      setErrors(parsed.errors);
      const first = Object.keys(parsed.errors)[0];
      dialog.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setPending(true);
    setServerError("");
    let accountCreated = false;
    try {
      if (mode === "signup") {
        await customerAuthRequest("signup", parsed.input);
        accountCreated = true;
      }
      await customerAuthRequest("login", { phone: parsed.input.phone, password: fields.password });
      setFields(emptyFields);
      setOpen(false);
      window.dispatchEvent(new Event(CUSTOMER_AUTHENTICATED));
      router.refresh();
      queueMicrotask(() => returnFocus.current?.focus());
    } catch (error) {
      if (accountCreated) {
        setMode("login");
        setServerError("حساب شما ساخته شد. ورود کامل نشد؛ دوباره تلاش کنید.");
        return;
      }
      if (error instanceof AuthRequestError) {
        setServerError(error.message);
        if (error.code === "CONFLICT") setErrors({ phone: error.message });
      } else setServerError("درخواست انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }
  const currentYear = Number(
    new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric" })
      .formatToParts(new Date())
      .find((part) => part.type === "year")?.value,
  );
  return (
    <dialog
      ref={dialog}
      dir="rtl"
      className={styles.dialog}
      aria-labelledby="customer-auth-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onClose={() => {
        setOpen(false);
        setFields(emptyFields);
        returnFocus.current?.focus();
      }}
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <div className={styles.handle} aria-hidden="true" />
      <div className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden="true">
          {mode === "login" ? "↪" : "+"}
        </span>
        <div>
          <h2 id="customer-auth-title">
            {mode === "login" ? "ورود به حساب" : "عضویت در آرمانی کافه"}
          </h2>
          <p>
            {mode === "login"
              ? "برای مشاهده سفارش‌ها و باشگاه مشتریان"
              : "حساب خود را بسازید و سفارش دهید"}
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label="بستن"
          disabled={pending}
          onClick={close}
        >
          ×
        </button>
      </div>
      <form noValidate onSubmit={(event) => void submit(event)} className={styles.form}>
        {mode === "signup" && (
          <div className={styles.field}>
            <label htmlFor="customer-name">
              نام <span aria-hidden="true">*</span>
            </label>
            <input
              ref={mode === "signup" ? firstField : undefined}
              id="customer-name"
              name="displayName"
              autoComplete="name"
              maxLength={120}
              value={fields.displayName}
              onChange={(event) => update("displayName", event.target.value)}
              aria-invalid={!!errors.displayName}
              aria-describedby={errors.displayName ? "customer-name-error" : undefined}
            />
            {errors.displayName && (
              <small id="customer-name-error" role="alert">
                {errors.displayName}
              </small>
            )}
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor="customer-phone">
            شماره موبایل <span aria-hidden="true">*</span>
          </label>
          <div className={styles.phoneRow}>
            <input
              ref={mode === "login" ? firstField : undefined}
              id="customer-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              dir="ltr"
              placeholder="0912 345 6789"
              value={fields.phone}
              onChange={(event) => update("phone", event.target.value)}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? "customer-phone-error" : "customer-phone-hint"}
            />
            <span dir="ltr">🇮🇷 +98</span>
          </div>
          <small id="customer-phone-hint">شماره ثبت‌شده در ایران را وارد کنید.</small>
          {errors.phone && (
            <small id="customer-phone-error" role="alert">
              {errors.phone}
            </small>
          )}
        </div>
        {mode === "signup" && (
          <fieldset className={styles.birth}>
            <legend>
              تاریخ تولد (اختیاری) <small>تقویم شمسی</small>
            </legend>
            <div className={styles.dateRow}>
              <select
                name="birthDay"
                aria-label="روز تولد"
                value={fields.birthDay}
                onChange={(event) => update("birthDay", event.target.value)}
                aria-invalid={!!errors.birthDay}
                aria-describedby={errors.birthDay ? "customer-birth-error" : undefined}
              >
                <option value="">روز</option>
                {Array.from({ length: 31 }, (_, index) => (
                  <option key={index + 1} value={String(index + 1)}>
                    {formatPersianNumber(index + 1)}
                  </option>
                ))}
              </select>
              <select
                name="birthMonth"
                aria-label="ماه تولد"
                value={fields.birthMonth}
                onChange={(event) => update("birthMonth", event.target.value)}
              >
                <option value="">ماه</option>
                {months.map((month, index) => (
                  <option key={month} value={String(index + 1)}>
                    {month}
                  </option>
                ))}
              </select>
              <select
                name="birthYear"
                aria-label="سال تولد"
                value={fields.birthYear}
                onChange={(event) => update("birthYear", event.target.value)}
              >
                <option value="">سال</option>
                {Array.from({ length: 121 }, (_, index) => currentYear - index).map((year) => (
                  <option key={year} value={String(year)}>
                    {formatPersianNumber(year)}
                  </option>
                ))}
              </select>
            </div>
            {errors.birthDay && (
              <small id="customer-birth-error" role="alert">
                {errors.birthDay}
              </small>
            )}
          </fieldset>
        )}
        <div className={styles.field}>
          <label htmlFor="customer-password">
            رمز عبور <span aria-hidden="true">*</span>
          </label>
          <div className={styles.passwordRow}>
            <input
              id="customer-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={fields.password}
              onChange={(event) => update("password", event.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password
                  ? "customer-password-error"
                  : mode === "signup"
                    ? "customer-password-hint"
                    : undefined
              }
            />
            <button
              type="button"
              aria-label={visible ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"}
              aria-pressed={visible}
              onClick={() => setVisible((value) => !value)}
            >
              {visible ? "پنهان" : "نمایش"}
            </button>
          </div>
          {mode === "signup" && <small id="customer-password-hint">حداقل ۱۲ کاراکتر</small>}
          {errors.password && (
            <small id="customer-password-error" role="alert">
              {errors.password}
            </small>
          )}
        </div>
        {serverError && (
          <p className={styles.error} role="alert">
            {serverError}
          </p>
        )}
        <button className={styles.submit} type="submit" disabled={pending}>
          {pending
            ? "در حال بررسی اطلاعات…"
            : mode === "login"
              ? "ورود به حساب کاربری"
              : "ساخت حساب کاربری"}
        </button>
        <div className={styles.switch}>
          {mode === "login" ? "حساب کاربری ندارید؟" : "قبلاً ثبت‌نام کرده‌اید؟"}
          <button
            type="button"
            disabled={pending}
            onClick={() => switchMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "ثبت‌نام" : "ورود به حساب"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
