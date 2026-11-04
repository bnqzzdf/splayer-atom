import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { findLatestCoreArtifact, readDirettaCpuVariantFromNativeBuild } from "./core-artifact-name";

const root = fileURLToPath(new URL("../..", import.meta.url));
const nodeBinary = process.env.ATOM_NODE_BIN || process.execPath;
const bunBinary = process.env.ATOM_BUN_BIN || "bun";
const rounds = Number(process.env.ATOM_BENCH_ROUNDS || 5);
const requests = Number(process.env.ATOM_BENCH_REQUESTS || 100);

type RuntimeName = "node" | "bun";
const stages = mkdtempSync(path.join(os.tmpdir(), "atom-runtime-bench-stages-"));
for (const runtime of ["node", "bun"] as const) {
  const stage = path.join(stages, runtime);
  mkdirSync(stage);
  const archive = findLatestCoreArtifact(
    root,
    false,
    readDirettaCpuVariantFromNativeBuild(root),
    runtime,
  );
  const extract = spawnSync("tar", ["-xzf", archive, "-C", stage]);
  if (extract.status !== 0) throw new Error(`无法解压 ${runtime} benchmark artifact: ${archive}`);
}
interface Result {
  runtime: RuntimeName;
  startupMs: number;
  rssMiB: number;
  pssMiB: number | null;
  requestsPerSec: number;
}

const portAvailable = async (): Promise<number> => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

const getMemory = (pid: number): { rssMiB: number; pssMiB: number | null } => {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const rssKiB = Number(status.match(/^VmRSS:\s+(\d+) kB/m)?.[1] || 0);
  let pssMiB: number | null = null;
  try {
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    pssMiB = Number(rollup.match(/^Pss:\s+(\d+) kB/m)?.[1] || 0) / 1024;
  } catch {
    // smaps_rollup may be unavailable to unprivileged callers.
  }
  return { rssMiB: rssKiB / 1024, pssMiB };
};

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
};

const run = async (runtime: RuntimeName): Promise<Result> => {
  const stage = path.join(stages, runtime);
  const launcher = path.join(stage, "bin/splayer-atom-core");
  if (!existsSync(launcher)) throw new Error(`Missing staged launcher: ${launcher}`);
  const temp = mkdtempSync(path.join(os.tmpdir(), `atom-${runtime}-bench-`));
  for (const name of ["home", "data", "cache", "music"]) mkdirSync(path.join(temp, name));
  const port = await portAvailable();
  const started = performance.now();
  const child = spawn(launcher, [], {
    cwd: stage,
    env: {
      ...process.env,
      HOME: path.join(temp, "home"),
      XDG_DATA_HOME: path.join(temp, "home"),
      XDG_CACHE_HOME: path.join(temp, "cache"),
      ATOM_DATA_DIR: path.join(temp, "data"),
      ATOM_CACHE_DIR: path.join(temp, "cache"),
      ATOM_MUSIC_DIR: path.join(temp, "music"),
      ATOM_NODE_BIN: runtime === "node" ? nodeBinary : "",
      ATOM_BUN_BIN: runtime === "bun" ? bunBinary : "",
      ATOM_SERVER_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (buf: Buffer) => (output += buf.toString().slice(0, 10000)));
  child.stderr?.on("data", (buf: Buffer) => (output += buf.toString().slice(0, 10000)));
  const info = `http://127.0.0.1:${port}/api/info`;

  try {
    let startupMs = 0;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`Core exited: ${child.exitCode}\n${output}`);
      try {
        const response = await fetch(info, { signal: AbortSignal.timeout(350) });
        if (response.ok && (await response.json()).name) {
          startupMs = performance.now() - started;
          break;
        }
      } catch {}
      if (performance.now() - started > 15000) throw new Error(`Core start timeout\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    await new Promise((resolve) => setTimeout(resolve, 650));
    const memory = getMemory(child.pid!);
    const begin = performance.now();
    for (let i = 0; i < requests; i++) {
      const response = await fetch(info);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
    }
    const elapsed = performance.now() - begin;
    return { runtime, startupMs, ...memory, requestsPerSec: (requests * 1000) / elapsed };
  } finally {
    await stop(child);
    rmSync(temp, { recursive: true, force: true });
  }
};

const median = (numbers: number[]): number => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

if (!Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(requests) || requests < 1) {
  throw new Error("ATOM_BENCH_ROUNDS and ATOM_BENCH_REQUESTS must be positive integers");
}

const results: Result[] = [];
for (let round = 0; round < rounds; round++) {
  const order: RuntimeName[] = round % 2 === 0 ? ["node", "bun"] : ["bun", "node"];
  for (const runtime of order) {
    const result = await run(runtime);
    results.push(result);
    console.log(`[Benchmark] round=${round + 1} ${JSON.stringify(result)}`);
  }
}

const summary = Object.fromEntries(
  (["node", "bun"] as const).map((runtime) => {
    const rows = results.filter((r) => r.runtime === runtime);
    return [
      runtime,
      {
        startupMs: median(rows.map((r) => r.startupMs)),
        rssMiB: median(rows.map((r) => r.rssMiB)),
        pssMiB: rows.every((r) => r.pssMiB !== null)
          ? median(rows.map((r) => r.pssMiB!))
          : null,
        requestsPerSec: median(rows.map((r) => r.requestsPerSec)),
      },
    ];
  }),
);

const report = { platform: process.platform, arch: process.arch, rounds, requests, summary, results };
const reportFile = path.join(root, "out/bun-node-benchmark.json");
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[Benchmark] summary ${JSON.stringify(summary)}`);
console.log(`[Benchmark] report ${reportFile}`);
rmSync(stages, { recursive: true, force: true });
