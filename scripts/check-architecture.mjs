import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export const moduleNames = [
  "auth",
  "admins",
  "customers",
  "media",
  "settings",
  "catalog/categories",
  "catalog/products",
  "carts",
  "payments",
  "orders",
  "inventory",
  "invoices",
  "printing",
  "analytics",
  "audit",
  "notifications",
];

const layers = ["domain", "application", "infrastructure", "contracts"];
const sourceExtensions = new Set([".ts", ".tsx", ".mts"]);

export async function readSourceTree(directory) {
  const files = new Map();
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        const relative = path.relative(directory, absolute).replaceAll("\\", "/");
        files.set(`src/${relative}`, await readFile(absolute, "utf8"));
      }
    }
  }
  await visit(directory);
  return files;
}

function moduleOf(file) {
  for (const name of moduleNames) {
    const prefix = `src/modules/${name}/`;
    if (file.startsWith(prefix)) return { name, path: file.slice(prefix.length) };
  }
  return null;
}

function layerOf(moduleFile) {
  if (moduleFile.path === "index.ts") return "public";
  if (moduleFile.path === "server.ts") return "server";
  return moduleFile.path.split("/")[0];
}

function importsFrom(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}

function resolveLocal(file, specifier, files) {
  let base;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  } else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}/index.ts`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function isPublicModuleFile(moduleFile) {
  return moduleFile.path === "index.ts" || moduleFile.path === "server.ts";
}

export function architectureViolations(files, { requireLayout = true } = {}) {
  const violations = [];
  const graph = new Map();

  if (requireLayout) {
    for (const name of moduleNames) {
      for (const file of ["index.ts", "server.ts", ...layers.map((layer) => `${layer}/index.ts`)]) {
        if (!files.has(`src/modules/${name}/${file}`)) {
          violations.push(`Missing module boundary: ${name}/${file}`);
        }
      }
    }
  }

  for (const [file, source] of files) {
    const sourceModule = moduleOf(file);
    const sourceLayer = sourceModule && layerOf(sourceModule);
    if (sourceModule && ![...layers, "public", "server"].includes(sourceLayer)) {
      violations.push(`${file}: file must live in a declared module layer or public boundary`);
    }
    if (sourceLayer === "infrastructure" || sourceLayer === "server") {
      if (!/^import\s+["']server-only["'];?\s*$/m.test(source)) {
        violations.push(`${file}: server-only marker is required`);
      }
    }
    const edges = [];
    for (const specifier of importsFrom(file, source)) {
      if (
        sourceModule &&
        ["domain", "application", "contracts"].includes(sourceLayer) &&
        /^(react(?:-dom)?(?:\/|$)|next(?:\/|$))/.test(specifier)
      ) {
        violations.push(`${file}: ${sourceLayer} must not import ${specifier}`);
      }
      const target = resolveLocal(file, specifier, files);
      if (!target) continue;
      edges.push(target);
      const targetModule = moduleOf(target);
      const targetLayer = targetModule && layerOf(targetModule);

      if (file.startsWith("src/app/") && targetModule && !isPublicModuleFile(targetModule)) {
        violations.push(`${file}: UI/routes must use the public module boundary, not ${target}`);
      }
      if (
        file.startsWith("src/app/") &&
        /^src\/server\/(database|secrets|minio|queue|payments)\//.test(target)
      ) {
        violations.push(`${file}: UI/routes must not import persistence internals: ${target}`);
      }
      if (file.startsWith("src/shared/") && !target.startsWith("src/shared/")) {
        violations.push(`${file}: shared primitives must not depend on ${target}`);
      }
      if (!sourceModule && targetModule && !isPublicModuleFile(targetModule)) {
        violations.push(`${file}: module internals are private: ${target}`);
      }
      if (!sourceModule) continue;
      if (target.startsWith("src/app/")) {
        violations.push(`${file}: modules must not import route or UI code: ${target}`);
      }
      if (
        ["domain", "application", "contracts"].includes(sourceLayer) &&
        target.startsWith("src/server/")
      ) {
        violations.push(`${file}: ${sourceLayer} must not import server infrastructure: ${target}`);
      }
      if (targetModule && targetModule.name !== sourceModule.name) {
        if (!isPublicModuleFile(targetModule) || !["application", "server"].includes(sourceLayer)) {
          violations.push(
            `${file}: cross-module imports must use another module's public boundary from application/server: ${target}`,
          );
        }
      } else if (targetModule && targetModule.name === sourceModule.name) {
        const allowed =
          {
            domain: ["domain"],
            contracts: ["contracts", "domain"],
            application: ["application", "domain", "contracts"],
            infrastructure: ["infrastructure", "application", "domain", "contracts"],
            public: ["public", "domain", "contracts"],
            server: ["server", "application", "infrastructure", "domain", "contracts"],
          }[sourceLayer] ?? [];
        if (!allowed.includes(targetLayer)) {
          violations.push(`${file}: ${sourceLayer} must not import ${targetLayer}: ${target}`);
        }
      }
    }
    graph.set(file, edges);
  }

  const state = new Map();
  const stack = [];
  function visit(file) {
    if (state.get(file) === "done") return;
    if (state.get(file) === "active") {
      const start = stack.indexOf(file);
      violations.push(`Circular dependency: ${[...stack.slice(start), file].join(" -> ")}`);
      return;
    }
    state.set(file, "active");
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    state.set(file, "done");
  }
  for (const file of graph.keys()) visit(file);
  return violations;
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  const violations = architectureViolations(await readSourceTree(path.resolve("src")));
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Module architecture verified.");
  }
}
