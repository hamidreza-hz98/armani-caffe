import { handleCustomerOtp, handleCustomerOtpStatus } from "@/modules/sms/server";

export const runtime = "nodejs";

export const POST = handleCustomerOtp;
export const GET = handleCustomerOtpStatus;
