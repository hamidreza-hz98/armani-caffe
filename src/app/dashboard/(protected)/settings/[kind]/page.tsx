import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";

import { requireDashboardActor } from "@/dashboard/server";
import { SettingsManager } from "@/dashboard/settings/manager";
import type { OwnerSettings } from "@/modules/settings";
import { createSettingsService } from "@/modules/settings/server";

export const metadata: Metadata = {
  title: "تنظیمات کسب‌وکار",
  robots: { index: false, follow: false },
};
const kinds = ["business", "contact", "seo", "printing"] as const;
export default async function SettingsKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!kinds.some((candidate) => candidate === kind)) notFound();
  const actor = await requireDashboardActor();
  if (actor.role !== "OWNER") forbidden();
  const settings = await (await createSettingsService()).read(actor, kind);
  return <SettingsManager initial={settings as OwnerSettings} />;
}
