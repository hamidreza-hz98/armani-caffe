import "server-only";

import { performance } from "node:perf_hooks";

import { logEvent } from "../observability/index.ts";
import { dependencyProbes } from "./probes.ts";

export type DependencyName = "mongodb" | "redis" | "minio";
export type Readiness = Readonly<{
  status: "ready" | "not_ready";
  checks: Record<DependencyName, "up" | "down">;
}>;

export async function checkReadiness(
  probes: Record<DependencyName, () => Promise<void>> = dependencyProbes,
): Promise<Readiness> {
  const names: DependencyName[] = ["mongodb", "redis", "minio"];
  const checks = {} as Record<DependencyName, "up" | "down">;
  await Promise.all(
    names.map(async (name) => {
      const started = performance.now();
      try {
        await probes[name]();
        checks[name] = "up";
      } catch (error) {
        checks[name] = "down";
        logEvent("warn", "readiness.dependency_failed", {
          dependency: name,
          durationMs: Math.round(performance.now() - started),
          error,
        });
      }
    }),
  );
  return { status: names.every((name) => checks[name] === "up") ? "ready" : "not_ready", checks };
}
