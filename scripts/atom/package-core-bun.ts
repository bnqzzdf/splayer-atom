import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CORE_NODE_REFERENCE } from "../../core/atom/runtime/nodeRuntime";

const root = fileURLToPath(new URL("../..", import.meta.url));
const stagedNode = path.join(root, "out/core-system");
const args = new Set(process.argv.slice(2));
const bundleBun = args.delete("--bundle-bun");
if (args.size) throw new Error(`Unknown Bun package arguments: ${[...args].join(" ")}`);
const stagedBun = path.join(root, bundleBun ? "out/core-bun-bundled" : "out/core-bun-system");
const bunBinary = process.env.ATOM_BUN_BIN || "bun";

const run = (command: string, args: string[], cwd = root): string => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return (result.stdout ?? "").trim();
};

if (process.versions.node !== CORE_NODE_REFERENCE) {
  throw new Error(`Bun experimental package requires build Node ${CORE_NODE_REFERENCE}`);
}
const bunVersion = run(bunBinary, ["--version"]);
if (!/^\d+\.\d+\.\d+/.test(bunVersion)) throw new Error(`Unexpected Bun version: ${bunVersion}`);

run("pnpm", ["exec", "tsx", "scripts/atom/stage-core-system.ts", "--archive", "--allow-unpublished"]);
if (!existsSync(path.join(stagedNode, "runtime.json"))) throw new Error("Missing Node staging");
run("pnpm", ["exec", "tsx", "scripts/atom/check-core-artifact.ts"]);
run(bunBinary, ["scripts/atom/check-bun-plugin-ipc.ts"]);

rmSync(stagedBun, { recursive: true, force: true });
cpSync(stagedNode, stagedBun, { recursive: true });
cpSync(
  path.join(root, "scripts/atom/core-system/splayer-atom-core-bun"),
  path.join(stagedBun, "bin/splayer-atom-core"),
);
chmodSync(path.join(stagedBun, "bin/splayer-atom-core"), 0o755);
cpSync(path.join(root, "docs/bun-runtime-experiment.md"), path.join(stagedBun, "docs/bun-runtime-experiment.md"));
if (bundleBun) {
  const bundledBun = path.join(stagedBun, "runtime/bin/bun");
  mkdirSync(path.dirname(bundledBun), { recursive: true });
  const originalBun = realpathSync(run(bunBinary, ["-p", "process.execPath"]));
  cpSync(originalBun, bundledBun);
  chmodSync(bundledBun, 0o755);
  if (run(bundledBun, ["--version"]) !== bunVersion) {
    throw new Error("Bundled Bun does not match the packaging runtime");
  }
  writeFileSync(
    path.join(stagedBun, "runtime/BUN-LICENSE-NOTICE.txt"),
    `Bun ${bunVersion} is developed by the Bun contributors. Bun is MIT-licensed and statically links components with additional licensing requirements, including LGPL-2.\nReview the license and redistribution obligations before public release:\nhttps://github.com/oven-sh/bun/blob/bun-v${bunVersion}/LICENSE.md\nhttps://bun.com/docs/project/license\n`,
  );
}

const stagedEntry = path.join(stagedBun, "app/plugin-host.js");
const smokeBun = bundleBun ? path.join(stagedBun, "runtime/bin/bun") : bunBinary;
const stagedSmoke = spawnSync(smokeBun, ["scripts/atom/check-bun-plugin-ipc.ts"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, ATOM_PLUGIN_HOST_ENTRY: stagedEntry },
});
if (stagedSmoke.error || stagedSmoke.status !== 0 || stagedSmoke.signal) {
  throw new Error(`Bun staged plugin host smoke failed: ${stagedSmoke.error?.message ?? ""}\n${stagedSmoke.stdout ?? ""}${stagedSmoke.stderr ?? ""}`);
}

const runtimeFile = path.join(stagedBun, "runtime.json");
const runtime = JSON.parse(readFileSync(runtimeFile, "utf8")) as Record<string, unknown>;
runtime.runtime = { name: "bun", version: bunVersion, pluginHost: "bun" };
runtime.nodeBundled = false;
runtime.bunBundled = bundleBun;
writeFileSync(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`);

const fileName = `splayer-atom-core-${runtime.atomVersion}-${String(runtime.atomCommit).slice(0, 8)}-bun-${bunVersion}-${bundleBun ? "bundled" : "system"}-linux-x64.tar.gz`;
const archive = path.join(root, "out", fileName);
rmSync(archive, { force: true });
run("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "-czf", archive, "."], stagedBun);
console.log(`[BunPackage] PASS ${archive}`);
console.log(
  bundleBun
    ? `[BunPackage] Bundled Bun ${bunVersion} at runtime (trusted plugins only)`
    : `[BunPackage] Requires Bun ${bunVersion} at runtime (trusted plugins only)`,
);
