import type { NextConfig } from "next";

import { parseServerConfig } from "./src/config/server-schema.ts";

const mode = process.env.NODE_ENV;
if (mode !== "development" && mode !== "production" && mode !== "test") {
  throw new Error("NODE_ENV must be development, production, or test");
}
parseServerConfig(process.env, mode);

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
