import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import { boundaryViolations } from "../../scripts/check-server-boundaries.mjs";

test("server boundary check catches unmarked modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "armani-boundary-"));
  try {
    for (const domain of ["database", "secrets", "minio", "queue", "payments"]) {
      const directory = path.join(root, domain);
      await mkdir(directory);
      await writeFile(path.join(directory, "index.ts"), 'import "server-only";\n');
    }

    assert.deepEqual(await boundaryViolations(root), []);
    await writeFile(path.join(root, "payments", "provider.ts"), "export const provider = true;\n");
    assert.deepEqual(await boundaryViolations(root), [
      `Missing import "server-only": ${path.join("payments", "provider.ts")}`,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
