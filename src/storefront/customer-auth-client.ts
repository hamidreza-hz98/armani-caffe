import { gregorianToJalali, jalaliToGregorian } from "@/shared/jalali-date";
import { normalizeIranianMobile } from "@/shared/phone";

export type AuthMode = "login" | "signup";
export type AuthFields = {
  phone: string;
  password: string;
  displayName: string;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
};
export type AuthFieldErrors = Partial<Record<keyof AuthFields, string>>;

export function validateAuthFields(mode: AuthMode, fields: AuthFields) {
  const errors: AuthFieldErrors = {};
  let phone = "";
  try {
    phone = normalizeIranianMobile(fields.phone);
  } catch {
    errors.phone = "شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود.";
  }
  if (!fields.password || (mode === "signup" && [...fields.password].length < 12))
    errors.password =
      mode === "signup" ? "رمز عبور باید حداقل ۱۲ کاراکتر باشد." : "رمز عبور را وارد کنید.";
  if ([...fields.password].length > 128) errors.password = "رمز عبور بیش از حد طولانی است.";
  if (mode === "signup" && (!fields.displayName.trim() || fields.displayName.length > 120))
    errors.displayName = "نام را وارد کنید (حداکثر ۱۲۰ کاراکتر).";
  let birthDate: string | null = null;
  if (mode === "signup" && (fields.birthYear || fields.birthMonth || fields.birthDay)) {
    try {
      if (!fields.birthYear || !fields.birthMonth || !fields.birthDay) throw new Error();
      birthDate = jalaliToGregorian(
        `${fields.birthYear}-${fields.birthMonth.padStart(2, "0")}-${fields.birthDay.padStart(2, "0")}`,
      );
      const today = new Date().toISOString().slice(0, 10);
      if (birthDate > today || gregorianToJalali(birthDate).slice(0, 4) !== fields.birthYear)
        throw new Error();
    } catch {
      errors.birthDay = "تاریخ تولد شمسی معتبر نیست.";
    }
  }
  return {
    errors,
    input:
      mode === "login"
        ? { phone, password: fields.password }
        : {
            phone,
            password: fields.password,
            displayName: fields.displayName.trim(),
            birthDate,
          },
  };
}

type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; requestId?: string } };

export class AuthRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function customerAuthRequest<T>(
  operation: "login" | "signup" | "logout",
  body: object,
) {
  let response: Response;
  try {
    response = await fetch(`/api/customer/auth/${operation}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthRequestError("UNAVAILABLE", "اتصال به سرور برقرار نشد. دوباره تلاش کنید.");
  }
  let result: ApiResult<T>;
  try {
    result = (await response.json()) as ApiResult<T>;
  } catch {
    throw new AuthRequestError("UNAVAILABLE", "پاسخ سرور دریافت نشد. دوباره تلاش کنید.");
  }
  if (!response.ok || !result.ok) {
    if (result.ok) throw new AuthRequestError("UNAVAILABLE", "ورود انجام نشد. دوباره تلاش کنید.");
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "شماره موبایل یا رمز عبور درست نیست.",
      RATE_LIMITED: "تلاش‌های زیادی انجام شده است. کمی بعد دوباره امتحان کنید.",
      CONFLICT: "این شماره موبایل قبلاً ثبت شده است.",
      VALIDATION: "اطلاعات واردشده معتبر نیست. فیلدها را بررسی کنید.",
    };
    throw new AuthRequestError(
      result.error.code,
      messages[result.error.code] ?? "درخواست انجام نشد. دوباره تلاش کنید.",
    );
  }
  return result.value;
}
