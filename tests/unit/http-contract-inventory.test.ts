import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { expect, test } from "vitest";

async function sources(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await sources(path)));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) output.push(path);
  }
  return output;
}

test("every App Router API path is named in the human-readable contract inventory", async () => {
  const api = join(process.cwd(), "src", "app", "api");
  const documentation = await readFile(join(process.cwd(), "docs", "http-contracts.md"), "utf8");
  const routes = (await sources(api)).filter((path) => path.endsWith(`${sep}route.ts`));
  expect(routes.length).toBeGreaterThan(40);
  for (const route of routes) {
    const path = `/api/${relative(api, route)
      .replaceAll(sep, "/")
      .replace(/\/route\.ts$/u, "")}`;
    expect(documentation, `Missing documented route ${path}`).toContain(path);
  }
});

test("server-rendered application files do not HTTP-fetch their own API", async () => {
  const app = join(process.cwd(), "src", "app");
  for (const path of await sources(app)) {
    if (path.includes(`${sep}api${sep}`)) continue;
    const source = await readFile(path, "utf8");
    if (/^\s*["']use client["']/mu.test(source)) continue;
    expect(source, `Server Component self-fetch in ${path}`).not.toMatch(
      /\bfetch\s*\(\s*["'`]\/api\//u,
    );
  }
});
