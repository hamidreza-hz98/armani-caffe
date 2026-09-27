import "server-only";

import { parseServerConfig, type ServerConfig } from "@/config/server-schema";

let cached: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  const mode = process.env.NODE_ENV;
  if (mode !== "development" && mode !== "production" && mode !== "test") {
    throw new Error("NODE_ENV must be development, production, or test");
  }
  cached = parseServerConfig(process.env, mode);
  return cached;
}
