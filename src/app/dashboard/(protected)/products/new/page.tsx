import type { Metadata } from "next";

import { ProductEditor } from "@/dashboard/products/editor";
import { productEditorData } from "@/dashboard/products/server";

export const metadata: Metadata = { title: "محصول جدید" };

export default async function NewProductPage() {
  const data = await productEditorData(undefined, true);
  return <ProductEditor {...data} />;
}
