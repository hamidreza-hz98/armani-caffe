"use client";

import Button from "@mui/material/Button";
import DialogContent from "@mui/material/DialogContent";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { formatPersianNumber } from "@/theme/format";

import styles from "./customer-auth.module.css";
import {
  type AuthFieldErrors,
  type AuthFields,
  type AuthMode,
  validateAuthFields,
} from "./customer-auth-client";
import { OPEN_CUSTOMER_AUTH } from "./customer-auth-events";

const emptyFields: AuthFields = {
  phone: "",
  firstName: "",
  lastName: "",
  birthYear: "",
  birthMonth: "",
  birthDay: "",
};
const months = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

export function CustomerAuthSheet() {
  const firstField = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [step, setStep] = useState<"details" | "otp">("details");
  const [fields, setFields] = useState<AuthFields>(emptyFields);
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [serverError, setServerError] = useState("");
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(120);

  useEffect(() => {
    const onOpen = (event: Event) => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setMode((event as CustomEvent<AuthMode>).detail === "signup" ? "signup" : "login");
      setFields(emptyFields);
      setErrors({});
      setServerError("");
      setStep("details");
      setOpen(true);
    };
    window.addEventListener(OPEN_CUSTOMER_AUTH, onOpen);
    return () => window.removeEventListener(OPEN_CUSTOMER_AUTH, onOpen);
  }, []);
  useEffect(() => {
    if (!open || step !== "otp" || secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [open, step, secondsLeft]);

  function close() {
    setOpen(false);
    setFields(emptyFields);
    queueMicrotask(() => returnFocus.current?.focus());
  }
  function switchMode(next: AuthMode) {
    setMode(next);
    setStep("details");
    setErrors({});
    setServerError("");
    setFields(emptyFields);
  }
  function update(key: keyof AuthFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setServerError("");
  }
  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = validateAuthFields(mode, fields);
    if (Object.keys(parsed.errors).length) {
      setErrors(parsed.errors);
      const first = Object.keys(parsed.errors)[0];
      document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setFields((current) => ({ ...current, phone: parsed.input.phone }));
    setStep("otp");
    setOtp("");
    setSecondsLeft(120);
    setServerError("");
  }
  function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otp.length !== 6) {
      setServerError("کد تأیید باید ۶ رقم باشد.");
      return;
    }
    setServerError("تأیید پیامکی در نسخه بعدی فعال می‌شود. فعلاً امکان ورود با کد وجود ندارد.");
  }
  const currentYear = Number(
    new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric" })
      .formatToParts(new Date())
      .find((part) => part.type === "year")?.value,
  );
  const timeText = `${formatPersianNumber(Math.floor(secondsLeft / 60))}:${formatPersianNumber(secondsLeft % 60).padStart(2, "۰")}`;

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={close}
      ModalProps={{ keepMounted: true }}
      slotProps={{
        backdrop: {
          onClick: (event) => {
            if (event.target === event.currentTarget) close();
          },
        },
        paper: {
          className: styles.dialog,
          sx: {
            m: 0,
            alignSelf: "stretch",
            width: "100vw",
            maxWidth: "100vw",
            left: 0,
            right: 0,
            boxSizing: "border-box",
            maxHeight: "90dvh",
          },
          role: "dialog",
          "aria-labelledby": "customer-auth-title",
          dir: "rtl",
        },
      }}
    >
      <div className={styles.handle} aria-hidden="true" />
      <div className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden="true">{step === "otp" ? "✓" : mode === "login" ? "↪" : "+"}</span>
        <div>
          <Typography component="h2" id="customer-auth-title" variant="h6">
            {step === "otp" ? "تأیید شماره موبایل" : mode === "login" ? "ورود به حساب" : "عضویت در آرمانی کافه"}
          </Typography>
          <Typography component="p" variant="caption">
            {step === "otp" ? `کد تأیید برای ${fields.phone} ارسال خواهد شد.` : mode === "login" ? "برای مشاهده سفارش‌ها و باشگاه مشتریان" : "حساب خود را بسازید و سفارش دهید"}
          </Typography>
        </div>
        <IconButton className={styles.close} aria-label="بستن" onClick={close}>×</IconButton>
      </div>
      <DialogContent className={styles.content}>
        {step === "otp" ? (
          <form noValidate onSubmit={submitOtp} className={styles.form}>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              پیامک حاوی کد ۶ رقمی برای این شماره ارسال خواهد شد.
            </Typography>
            <TextField
              inputRef={firstField}
              name="otp"
              label="کد تأیید"
              placeholder="— — — — — —"
              value={otp}
              onChange={(event) => { setOtp(event.target.value.replace(/\D/g, "").slice(0, 6)); setServerError(""); }}
              slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6, dir: "ltr", autoComplete: "one-time-code", "aria-label": "کد تأیید ۶ رقمی" } }}
              fullWidth
              autoFocus
            />
            {serverError && <p className={styles.error} role="alert">{serverError}</p>}
            <Typography className={styles.countdown} variant="body2" aria-live="polite">
              {secondsLeft > 0 ? `امکان ارسال دوباره کد تا ${timeText}` : "کد را دریافت نکردید؟"}
            </Typography>
            <Button className={styles.submit} variant="contained" type="submit" fullWidth>تأیید و ادامه</Button>
            <div className={styles.otpActions}>
              <Button variant="text" disabled={secondsLeft > 0} onClick={() => { setSecondsLeft(120); setServerError("ارسال پیامک در نسخه بعدی فعال می‌شود."); }}>
                ارسال دوباره کد
              </Button>
              <Button variant="text" onClick={() => { setStep("details"); setServerError(""); setOtp(""); }}>
                تغییر شماره موبایل
              </Button>
            </div>
          </form>
        ) : (
          <form noValidate onSubmit={submitDetails} className={styles.form}>
            {mode === "signup" && <>
              <TextField inputRef={firstField} name="firstName" label="نام" required autoComplete="given-name" value={fields.firstName} onChange={(e) => update("firstName", e.target.value)} error={!!errors.firstName} helperText={errors.firstName} fullWidth />
              <TextField name="lastName" label="نام خانوادگی" required autoComplete="family-name" value={fields.lastName} onChange={(e) => update("lastName", e.target.value)} error={!!errors.lastName} helperText={errors.lastName} fullWidth />
            </>}
            <TextField
              inputRef={mode === "login" ? firstField : undefined}
              name="phone"
              label="شماره موبایل"
              required
              type="tel"
              autoComplete="tel-national"
              placeholder="0912 345 6789"
              value={fields.phone}
              onChange={(e) => update("phone", e.target.value)}
              error={!!errors.phone}
              helperText={errors.phone || "شماره ثبت‌شده در ایران را وارد کنید."}
              slotProps={{ htmlInput: { inputMode: "tel", dir: "ltr" } }}
              fullWidth
            />
            {mode === "signup" && <fieldset className={styles.birth}>
              <legend>تاریخ تولد (اختیاری) <small>تقویم شمسی</small></legend>
              <div className={styles.dateRow}>
                <select name="birthDay" aria-label="روز تولد" value={fields.birthDay} onChange={(e) => update("birthDay", e.target.value)} aria-invalid={!!errors.birthDay}>
                  <option value="">روز</option>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{formatPersianNumber(i + 1)}</option>)}
                </select>
                <select name="birthMonth" aria-label="ماه تولد" value={fields.birthMonth} onChange={(e) => update("birthMonth", e.target.value)}>
                  <option value="">ماه</option>{months.map((month, i) => <option key={month} value={String(i + 1)}>{month}</option>)}
                </select>
                <select name="birthYear" aria-label="سال تولد" value={fields.birthYear} onChange={(e) => update("birthYear", e.target.value)}>
                  <option value="">سال</option>{Array.from({ length: 121 }, (_, i) => currentYear - i).map((year) => <option key={year} value={String(year)}>{formatPersianNumber(year)}</option>)}
                </select>
              </div>
              {errors.birthDay && <small role="alert">{errors.birthDay}</small>}
            </fieldset>}
            {serverError && <p className={styles.error} role="alert">{serverError}</p>}
            <Button className={styles.submit} variant="contained" type="submit" fullWidth>
              {mode === "login" ? "دریافت کد ورود" : "ثبت‌نام و دریافت کد"}
            </Button>
            <div className={styles.switch}>
              {mode === "login" ? "حساب کاربری ندارید؟" : "قبلاً ثبت‌نام کرده‌اید؟"}
              <Button variant="text" onClick={() => switchMode(mode === "login" ? "signup" : "login")}>
                {mode === "login" ? "ثبت‌نام" : "ورود به حساب"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Drawer>
  );
}
