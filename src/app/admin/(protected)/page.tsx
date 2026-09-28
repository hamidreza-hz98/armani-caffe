import type { Metadata } from "next";

import { requireAdminPage } from "@/modules/auth/server";

import { AdminLogout } from "./logout";

export const metadata: Metadata = {
  title: "پنل مدیریت | آرمانی کافه",
  robots: { index: false, follow: false },
};
export default async function AdminPage() {
  const actor = await requireAdminPage();
  return (
    <main>
      <h1>پنل مدیریت</h1>
      <p>خوش آمدید، {actor.displayName}</p>
      <AdminLogout />
    </main>
  );
}
