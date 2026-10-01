import type { ReactNode } from "react";

import { DashboardChrome } from "@/dashboard/chrome";
import { linksForRole } from "@/dashboard/navigation";
import { requireDashboardActor } from "@/dashboard/server";
import styles from "@/dashboard/shell.module.css";

export default async function ProtectedDashboardLayout({ children }: { children: ReactNode }) {
  const actor = await requireDashboardActor();
  return (
    <div className={styles.frame}>
      <a href="#dashboard-main" className={styles.srOnly}>
        رفتن به محتوای اصلی
      </a>
      <DashboardChrome
        links={linksForRole(actor.role)}
        actor={{ displayName: actor.displayName, role: actor.role }}
      />
      <main id="dashboard-main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
