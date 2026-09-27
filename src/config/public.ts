import { parsePublicConfig } from "./public-schema.ts";

// Next.js inlines only these explicit NEXT_PUBLIC_ references into client bundles.
export const publicConfig = parsePublicConfig({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
});
