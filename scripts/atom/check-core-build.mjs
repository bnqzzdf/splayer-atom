import { builtinModules } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const coreDir = path.join(root, "out", "core");
const allowedExternal = new Set(["better-sqlite3"]);
const builtins = new Set(
  builtinModules.flatMap((name) => [
    name,
    name.startsWith("node:") ? name.slice(5) : `node:${name}`,
  ]),
);

if (
  !existsSync(path.join(coreDir, "index.js")) ||
  !existsSync(path.join(coreDir, "plugin-host.js"))
) {
  throw new Error("[CoreBuild] out/core 缺少 index.js 或 plugin-host.js，请先构建 Core");
}

const jsFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (name.endsWith(".js")) jsFiles.push(file);
  }
};
walk(coreDir);

const externalRefs = new Map();
const record = (specifier, file) => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || builtins.has(specifier)) return;
  const files = externalRefs.get(specifier) ?? [];
  files.push(path.relative(root, file));
  externalRefs.set(specifier, files);
};

for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  const staticImport = /(?:^|\n)import(?:\s+[^'"\n]+?\s+from\s+|\s*)["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(["']([^"']+)["']\)/g;
  const commonJsRequire = /\brequire\(["']([^"']+)["']\)/g;
  for (const pattern of [staticImport, dynamicImport, commonJsRequire]) {
    for (const match of source.matchAll(pattern)) record(match[1], file);
  }
}

if (externalRefs.has("electron")) {
  throw new Error(
    `[CoreBuild] Core production bundle 禁止 Electron runtime reference: ${externalRefs
      .get("electron")
      .join(", ")}`,
  );
}

const unexpected = [...externalRefs].filter(([specifier]) => !allowedExternal.has(specifier));
if (unexpected.length > 0) {
  throw new Error(
    `[CoreBuild] 非预期 external dependency: ${unexpected
      .map(([specifier, files]) => `${specifier} (${files.join(", ")})`)
      .join("; ")}`,
  );
}

console.log(`[CoreBuild] PASS ${jsFiles.length} JS files`);
console.log(`[CoreBuild] external: ${[...externalRefs.keys()].sort().join(", ") || "none"}`);
