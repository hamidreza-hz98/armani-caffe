import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { safeDashboardDestination } from "@/dashboard/navigation";
import { dashboardActor } from "@/dashboard/server";

import { DashboardLoginForm } from "./login-form";

export const metadata: Metadata = { title: "ورود مدیر" };

export default async function DashboardLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const destination = safeDashboardDestination((await searchParams).next);
  if (await dashboardActor()) redirect(destination);
  return <DashboardLoginForm destination={destination} />;
}
