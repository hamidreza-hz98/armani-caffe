import "server-only";

import { getDatabaseConnection } from "../../server/database/connection.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { SmsService } from "./application/index.ts";
import {
  createOtpHttpHandler,
  createOtpStatusHandler,
  customerOtpOrigin,
} from "./infrastructure/http.ts";
import { OtpService, SmsIrSender } from "./infrastructure/index.ts";

export type { SmsSender } from "./application/index.ts";
export { SmsService } from "./application/index.ts";
export { createOtpHttpHandler } from "./infrastructure/http.ts";
export {
  otpChallengeSchema,
  OtpService,
  SmsIrSender,
  smsSendThrottleSchema,
} from "./infrastructure/index.ts";

export function smsPreviewMode() {
  const sms = getServerConfig().sms;
  return !sms.apiKey;
}

export async function configuredOtpService() {
  const config = getServerConfig();
  const sms = config.sms;
  if (!sms.apiKey || !sms.loginTemplateId || !sms.signupTemplateId)
    throw new ApplicationError("UNAVAILABLE", "SMS.ir is not configured");
  return new OtpService(
    await getDatabaseConnection(),
    new SmsService(new SmsIrSender(sms.apiKey)),
    config.auth.sessionSecret,
    { "customer-login": sms.loginTemplateId, "customer-signup": sms.signupTemplateId },
    sms.codeParameter,
  );
}

export const handleCustomerOtp = createOtpHttpHandler({
  origin: customerOtpOrigin,
  preview: smsPreviewMode,
  send: async (phone, purpose) => (await configuredOtpService()).send(phone, purpose),
});
export const handleCustomerOtpStatus = createOtpStatusHandler(smsPreviewMode);
