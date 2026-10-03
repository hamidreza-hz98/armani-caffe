import "server-only";

import { forbidden } from "next/navigation";

import { requireDashboardActor } from "@/dashboard/server";
import { createMediaService } from "@/modules/media/server";
import { adminCapabilityMap } from "@/shared/admin-capabilities";

const allowed = ["page", "pageSize", "sort", "direction", "q", "mimeType", "visibility", "status"];
export async function mediaActor(manage = false) {
  const actor = await requireDashboardActor();
  if (!adminCapabilityMap[actor.role].includes(manage ? "media.manage" : "media.read")) forbidden();
  return actor;
}

export async function mediaListData(raw: Record<string, string | undefined>) {
  const actor = await mediaActor();
  const params = new URLSearchParams();
  for (const key of allowed) if (raw[key]) params.set(key, raw[key]!);
  if (!params.has("pageSize")) params.set("pageSize", "20");
  const service = await createMediaService();
  return { actor, result: await service.list(actor, params), params };
}
