import "server-only";

import { authenticateAdminRequest } from "@/modules/auth/server";
import { parseProviderCredentials } from "@/modules/settings";
import {
  createSettingsRepository,
  createSettingsService,
  SettingsVault,
} from "@/modules/settings/server";
import { getDatabaseConnection } from "@/server/database/connection";
import { readJsonBody } from "@/server/http/json";
import { getServerConfig } from "@/server/secrets/config";
import { requireAdminCapability } from "@/shared/admin-capabilities";
import { ApplicationError } from "@/shared/errors";

import { paymentSettingsData, probePaymentAdapter, requireInstalledProvider } from "./server";

function bodyObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ApplicationError("VALIDATION", "Invalid payment settings request");
  return raw as Record<string, unknown>;
}
function checkOrigin(request: Request) {
  const config = getServerConfig();
  const origin = request.headers.get("origin");
  if (![new URL(config.appUrl).origin, new URL(config.adminUrl).origin].includes(origin ?? ""))
    throw new ApplicationError("FORBIDDEN", "Invalid request origin");
}
export async function paymentSettingsOperation(
  request: Request,
  operation: "read" | "update" | "probe",
  requestId: string,
) {
  if (new URL(request.url).search) throw new ApplicationError("VALIDATION", "Unexpected query");
  const actor = requireAdminCapability(await authenticateAdminRequest(request), "settings.manage");
  if (operation === "read") return paymentSettingsData(actor);
  checkOrigin(request);
  const body = bodyObject(await readJsonBody(request));
  if (operation === "probe") {
    if (
      Object.keys(body).some((field) => field !== "providerId") ||
      typeof body.providerId !== "string"
    )
      throw new ApplicationError("VALIDATION", "Invalid provider probe");
    return probePaymentAdapter(body.providerId, actor);
  }
  if (
    Object.keys(body).some(
      (field) => !["revision", "values", "rotate", "credentialPatch"].includes(field),
    )
  )
    throw new ApplicationError("VALIDATION", "Invalid payment settings fields");
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[a-zA-Z0-9_-]{8,128}$/u.test(key))
    throw new ApplicationError("VALIDATION", "Idempotency key required");
  let secrets: { providerCredentials: string | null } | undefined;
  if (body.credentialPatch !== undefined) {
    const patch = bodyObject(body.credentialPatch);
    if (
      Object.keys(patch).some((field) => !["id", "value"].includes(field)) ||
      typeof patch.id !== "string" ||
      (patch.value !== null && typeof patch.value !== "string")
    )
      throw new ApplicationError("VALIDATION", "Invalid credential update");
    requireInstalledProvider(patch.id);
    if (patch.value !== null && patch.value !== "")
      parseProviderCredentials(JSON.stringify({ [patch.id]: patch.value }));
    if (patch.value !== "") {
      const config = getServerConfig();
      const connection = await getDatabaseConnection();
      const repository = createSettingsRepository(
        connection,
        new SettingsVault(config.encryption.key, config.encryption.previousKey),
      );
      const merged = await repository.withCredentials("payment", async (_, old) => {
        const values = old.providerCredentials
          ? parseProviderCredentials(old.providerCredentials)
          : {};
        if (patch.value === null) delete values[patch.id as string];
        else values[patch.id as string] = patch.value as string;
        return values;
      });
      secrets = { providerCredentials: Object.keys(merged).length ? JSON.stringify(merged) : null };
    }
  }
  await (
    await createSettingsService()
  ).update(
    actor,
    "payment",
    key,
    {
      revision: body.revision,
      values: body.values,
      rotate: body.rotate ?? false,
      ...(secrets ? { secrets } : {}),
    },
    requestId,
  );
  return paymentSettingsData(actor);
}
