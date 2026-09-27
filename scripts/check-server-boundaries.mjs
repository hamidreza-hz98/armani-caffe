import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const protectedDomains = ["database", "secrets", "minio", "queue", "payments"];
const sourceExtensions = new Set([".ts", ".tsx", ".mts"]);
const marker = /^import\s+["']server-only["'];?\s*$/m;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) return [entryPath];
      return [];
    }),
  );
  return files.flat();
}

export async function boundaryViolations(serverRoot) {
  const violations = [];

  for (const domain of protectedDomains) {
    const directory = path.join(serverRoot, domain);
    let files;

    try {
      files = await sourceFiles(directory);
    } catch (error) {
      if (error.code === "ENOENT") {
        violations.push(`Missing server boundary: ${domain}`);
        continue;
      }
      throw error;
    }

    if (files.length === 0) {
      violations.push(`Empty server boundary: ${domain}`);
    }

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (!marker.test(contents)) {
        violations.push(`Missing import "server-only": ${path.relative(serverRoot, file)}`);
      }
    }
  }

  return violations;
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  const serverRoot = path.resolve("src/server");
  const violations = await boundaryViolations(serverRoot);
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Server-only boundaries verified.");
  }
}
