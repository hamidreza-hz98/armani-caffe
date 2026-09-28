import type { ReactNode } from "react";

import { requireAdminPage } from "@/modules/auth/server";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return children;
}
