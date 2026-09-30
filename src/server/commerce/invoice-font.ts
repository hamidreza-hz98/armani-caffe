import "server-only";

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let cached: Promise<string> | undefined;
export function receiptFontDataUrl(): Promise<string> {
  cached ??= readFile(
    require.resolve("@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2"),
  ).then((bytes) => `data:font/woff2;base64,${bytes.toString("base64")}`);
  return cached;
}
