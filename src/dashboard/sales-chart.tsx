"use client";

import type { OverviewDay } from "@/modules/analytics";

import styles from "./overview.module.css";

export function SalesChart({ values }: { values: readonly OverviewDay[] }) {
  const max = Math.max(1, ...values.map((item) => item.salesToman));
  const points = values.map((item, index) => {
    const x = 24 + (index * 752) / Math.max(1, values.length - 1);
    const y = 190 - (item.salesToman / max) * 158;
    return { x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `24,190 ${line} 776,190`;
  return (
    <svg
      className={styles.chart}
      viewBox="0 0 800 215"
      role="img"
      aria-label={`روند فروش روزانه در ${values.length} روز؛ بیشترین فروش ${new Intl.NumberFormat("fa-IR").format(max)} تومان`}
    >
      <defs>
        <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c99a3d" stopOpacity=".32" />
          <stop offset="100%" stopColor="#c99a3d" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[32, 111, 190].map((y) => (
        <line key={y} x1="24" x2="776" y1={y} y2={y} stroke="#eadfce" strokeDasharray="4 5" />
      ))}
      <polygon points={area} fill="url(#sales-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke="#b78122"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points
        .filter((_, index) => index === 0 || index === points.length - 1)
        .map((point) => (
          <circle key={point.x} cx={point.x} cy={point.y} r="4" fill="#b78122" />
        ))}
    </svg>
  );
}
