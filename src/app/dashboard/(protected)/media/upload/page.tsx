import type { Metadata } from "next";

import { mediaActor } from "@/dashboard/media/server";
import { UploadQueue } from "@/dashboard/media/upload-queue";

export const metadata: Metadata = { title: "بارگذاری رسانه" };

export default async function MediaUploadPage() {
  await mediaActor(true);
  return <UploadQueue />;
}
