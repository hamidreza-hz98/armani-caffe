import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { SmsSender } from "../application/index.ts";
export { OtpService } from "./otp.ts";

export const otpChallengeSchema = new Schema(
  {
    _id: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    resendAt: { type: Date, required: true },
    attempts: { type: Number, required: true },
  },
  { ...documentSchemaOptions(), collection: "sms_otp_challenges" },
);
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sms_otp_expiry" });

export const smsSendThrottleSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { ...documentSchemaOptions(), collection: "sms_send_throttles" },
);
smsSendThrottleSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "sms_send_throttle_expiry" },
);

/** SMS.ir Panel V2 verification template adapter. */
export class SmsIrSender implements SmsSender {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async sendTemplate(message: Parameters<SmsSender["sendTemplate"]>[0]) {
    let response: Response;
    try {
      response = await this.fetcher("https://api.sms.ir/v1/send/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-KEY": this.apiKey,
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
    } catch {
      throw new ApplicationError("UNAVAILABLE", "SMS.ir request failed");
    }
    let result: { status?: number } | null = null;
    try {
      result = await response.json();
    } catch {
      /* invalid provider response */
    }
    if (!response.ok || result?.status !== 1)
      throw new ApplicationError("UNAVAILABLE", "SMS.ir rejected verification message");
  }
}
