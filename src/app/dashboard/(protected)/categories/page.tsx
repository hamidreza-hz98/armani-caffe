import type { Metadata } from "next";

import { CategoryManager } from "@/dashboard/categories/manager";
import { categoryPageData } from "@/dashboard/categories/server";

export const metadata: Metadata = { title: "دسته‌بندی‌های منو" };

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor, list, counts } = await categoryPageData();
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q.slice(0, 80) : "";
  const status = raw.status === "published" || raw.status === "draft" ? raw.status : "all";
  return (
    <CategoryManager
      initial={list}
      counts={counts}
      editable={actor.role === "OWNER"}
      q={q}
      status={status}
    />
  );
}
