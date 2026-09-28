export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED";

export class ApplicationError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown; details?: unknown }) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

const publicMessages: Record<ErrorCode, string> = {
  INVALID_CREDENTIALS: "نام کاربری یا رمز عبور معتبر نیست.",
  RATE_LIMITED: "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.",
  VALIDATION: "اطلاعات واردشده معتبر نیست.",
  NOT_FOUND: "مورد درخواستی پیدا نشد.",
  CONFLICT: "این درخواست با وضعیت فعلی سازگار نیست.",
  UNAUTHORIZED: "برای ادامه وارد حساب خود شوید.",
  FORBIDDEN: "اجازهٔ انجام این کار را ندارید.",
  UNAVAILABLE: "سرویس موقتاً در دسترس نیست. دوباره تلاش کنید.",
};

export type SafeError = Readonly<{
  code: ErrorCode | "INTERNAL";
  message: string;
  requestId: string;
}>;

export function serializeError(error: unknown, requestId: string): SafeError {
  if (error instanceof ApplicationError) {
    return { code: error.code, message: publicMessages[error.code], requestId };
  }
  return { code: "INTERNAL", message: "خطایی رخ داد. لطفاً دوباره تلاش کنید.", requestId };
}

export function errorStatus(code: SafeError["code"]): number {
  return {
    VALIDATION: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    UNAVAILABLE: 503,
    INTERNAL: 500,
    INVALID_CREDENTIALS: 401,
    RATE_LIMITED: 429,
  }[code];
}
