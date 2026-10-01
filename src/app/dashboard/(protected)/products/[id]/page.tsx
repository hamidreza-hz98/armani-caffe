import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductEditor } from "@/dashboard/products/editor";
import { productEditorData } from "@/dashboard/products/server";
import { ApplicationError } from "@/shared/errors";

export const metadata: Metadata = { title: "ویرایش محصول" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/u.test(id)) notFound();
  let data;
  try {
    data = await productEditorData(id);
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <ProductEditor {...data} />;
}
