"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { OverviewDay } from "@/modules/analytics";

import styles from "./overview.module.css";

const SalesChart = dynamic(() => import("./sales-chart").then((module) => module.SalesChart), {
  ssr: false,
  loading: () => <div className={styles.chartShell} aria-label="در حال بارگذاری نمودار" />,
});

export function LazySalesChart({ values }: { values: readonly OverviewDay[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className={styles.chartShell}>
      {visible ? <SalesChart values={values} /> : null}
    </div>
  );
}
