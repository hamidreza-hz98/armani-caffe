export type ErrorCode =
  "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "UNAUTHORIZED" | "FORBIDDEN" | "UNAVAILABLE";

export class ApplicationError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
  }
}
