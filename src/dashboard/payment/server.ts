import "server-only";

import { FakePaymentProvider, MemoryFakeLedger } from "@/modules/payments/server";
import { parseProviderCredentials } from "@/modules/settings";
import {
  createSettingsRepository,
  createSettingsService,
  SettingsVault,
} from "@/modules/settings/server";
import { installedGatewayIds } from "@/server/commerce/payment-adapters";
import { getDatabaseConnection } from "@/server/database/connection";
import { getServerConfig } from "@/server/secrets/config";
import { type AdminActor, requireAdminCapability } from "@/shared/admin-capabilities";
import { ApplicationError } from "@/shared/errors";

import type { AdapterCard, PaymentSettingsView, PaymentValues, ProbeResult } from "./model";

export async function paymentSettingsData(actor: AdminActor): Promise<PaymentSettingsView> {
  requireAdminCapability(actor, "settings.manage");
  const config = getServerConfig();
  const row = await (await createSettingsService()).read(actor, "payment");
  const connection = await getDatabaseConnection();
  const repository = createSettingsRepository(
    connection,
    new SettingsVault(config.encryption.key, config.encryption.previousKey),
  );
  const configuredIds = await repository.withCredentials("payment", async (_, secrets) =>
    secrets.providerCredentials
      ? Object.keys(parseProviderCredentials(secrets.providerCredentials))
      : [],
  );
  const callbackBase = new URL(config.paymentCallbackBaseUrl).origin;
  const installed = installedGatewayIds();
  const adapters: AdapterCard[] = [
    {
      id: "fake",
      label: "شبیه‌ساز توسعه",
      installed: true,
      selectable: config.mode !== "production",
      credentialRequired: false,
      callbackUrl: `${callbackBase}/api/payments/callback/fake/{id}`,
    },
    ...installed.map((id) => ({
      id,
      label: id,
      installed: true,
      selectable: true,
      credentialRequired: true,
      callbackUrl: `${callbackBase}/api/payments/callback/${id}/{id}`,
    })),
    {
      id: "iranian-gateway",
      label: "درگاه ایرانی (مرز توسعه)",
      installed: false,
      selectable: false,
      credentialRequired: true,
      callbackUrl: `${callbackBase}/api/payments/callback/iranian-gateway/{id}`,
    },
  ];
  return {
    revision: row.revision,
    values: row.values as PaymentValues,
    credentialConfigured: "credentials" in row && row.credentials.configured,
    configuredIds,
    adapters,
    production: config.mode === "production",
  };
}

/** Does not create a transaction or imply a real gateway succeeded. */
export async function probePaymentAdapter(id: string, actor: AdminActor): Promise<ProbeResult> {
  requireAdminCapability(actor, "settings.manage");
  const config = getServerConfig();
  const checkedAt = new Date().toISOString();
  if (id === "fake" && config.mode !== "production") {
    const provider = new FakePaymentProvider(new MemoryFakeLedger(), config.paymentCallbackBaseUrl);
    const request = {
      paymentId: "probe",
      idempotencyKey: "probe",
      amountToman: 1,
      callbackUrl: `${config.paymentCallbackBaseUrl}/api/payments/callback/fake/probe`,
      authority: null,
    };
    const result = await provider.create(request, AbortSignal.timeout(3000));
    return {
      status: result.kind === "created" ? "healthy" : "failed",
      message:
        result.kind === "created"
          ? "شبیه‌ساز داخلی بررسی شد؛ این اتصال بانکی واقعی نیست."
          : "شبیه‌ساز پاسخ معتبر نداد.",
      checkedAt,
    };
  }
  if (!installedGatewayIds().includes(id))
    return { status: "unavailable", message: "آداپتور این درگاه روی سرور نصب نیست.", checkedAt };
  // A future adapter needs an explicit, documented non-charging credential probe.
  return {
    status: "unavailable",
    message: "آزمون اتصال برای این آداپتور پیاده‌سازی نشده است؛ پرداخت آزمایشی ایجاد نشد.",
    checkedAt,
  };
}

export function requireInstalledProvider(id: string) {
  if (!installedGatewayIds().includes(id))
    throw new ApplicationError("VALIDATION", "Payment adapter is not installed");
}
