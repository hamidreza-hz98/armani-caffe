import type { NextConfig } from "next";

import { securityHeaders } from "./src/config/security-headers.ts";
import { parseServerConfig } from "./src/config/server-schema.ts";

const mode = process.env.NODE_ENV;
if (mode !== "development" && mode !== "production" && mode !== "test") {
  throw new Error("NODE_ENV must be development, production, or test");
}
parseServerConfig(process.env, mode);

const nextConfig: NextConfig = {
  experimental: { authInterrupts: true },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(mode) },
      {
        source: "/api/payments/callback/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
