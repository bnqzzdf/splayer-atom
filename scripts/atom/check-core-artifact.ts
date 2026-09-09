import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { CONFIG_SCHEMA_VERSION } from "../../core/atom/runtime/configSchema";
import { CORE_NODE_RANGE, CORE_NODE_REFERENCE } from "../../core/atom/runtime/nodeRuntime";
import { DATABASE_SCHEMA_VERSION } from "../../core/database/migration";
import { CORE_PROTOCOL_VERSION } from "../../shared/constants/coreProtocol";
import type { CoreInfo } from "../../shared/types/core";
import { DIRETTA_SDK_RELEASE } from "./diretta-sdk";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = new Set(process.argv.slice(2));
const bundleNode = args.delete("--bundle-node");
if (args.size > 0) throw new Error(`[CoreArtifact] 未知参数: ${[...args].join(" ")}`);
const archiveFile = path.join(
  root,
  "out",
  bundleNode
    ? "splayer-atom-core-bundled-linux-x64.tar.gz"
    : "splayer-atom-core-system-linux-x64.tar.gz",
);

const fail = (message: string): never => {
  throw new Error(`[CoreArtifact] ${message}`);
};

if (process.versions.node !== CORE_NODE_REFERENCE) {
  fail(
    `artifact smoke 必须使用 reference Node ${CORE_NODE_REFERENCE}，当前为 ${process.versions.node}`,
  );
}

const reservePort = async (): Promise<number> => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address) fail("无法分配 artifact smoke 端口");
  if (typeof address === "string") fail("artifact smoke 端口返回了非 TCP address");
  const port = (address as AddressInfo).port;
  server.close();
  await once(server, "close");
  return port;
};

const waitForJson = async <T>(url: string): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()) as T;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error(`请求超时: ${url}`);
};

const tempDir = mkdtempSync(path.join(tmpdir(), "splayer-atom-core-artifact-"));
let child: ReturnType<typeof spawn> | null = null;
try {
  const extract = spawnSync("tar", ["-xzf", archiveFile, "-C", tempDir], {
    encoding: "utf8",
  });
  if (extract.error) throw extract.error;
  if (extract.status !== 0 || extract.signal) {
    fail(`解包失败: ${`${extract.stdout ?? ""}${extract.stderr ?? ""}`.trim()}`);
  }

  const installRoot = path.join(tempDir, "core-system");
  const runtime = JSON.parse(readFileSync(path.join(installRoot, "runtime.json"), "utf8")) as {
    productName?: string;
    atomVersion?: string;
    atomCommit?: string;
    sourceDirty?: boolean;
    nodeRange?: string;
    nodeReference?: string;
    nodeBundled?: boolean;
    protocolVersion?: number;
    dataSchema?: { database?: number; config?: number };
    capabilities?: CoreInfo["capabilities"];
    direttaSdkRelease?: number | null;
  };
  if (
    runtime.productName !== "SPlayer Atom" ||
    !runtime.atomVersion ||
    !runtime.atomCommit ||
    typeof runtime.sourceDirty !== "boolean"
  ) {
    fail("runtime.json 缺少 SPlayer Atom release identity metadata");
  }
  if (runtime.nodeRange !== CORE_NODE_RANGE || runtime.nodeReference !== CORE_NODE_REFERENCE) {
    fail("runtime.json 与 Core Node contract 不一致");
  }
  if (runtime.nodeBundled !== bundleNode) {
    fail(`runtime.json nodeBundled 与 artifact 变体不一致: ${String(runtime.nodeBundled)}`);
  }
  const bundledNode = path.join(installRoot, "runtime", "bin", "node");
  const bundledNodeLicense = path.join(installRoot, "runtime", "LICENSE");
  if (bundleNode !== existsSync(bundledNode)) {
    fail(
      bundleNode ? "bundled-runtime 缺少 runtime/bin/node" : "system-runtime 不应携带 bundled Node",
    );
  }
  if (bundleNode !== existsSync(bundledNodeLicense)) {
    fail(bundleNode ? "bundled-runtime 缺少 Node LICENSE" : "system-runtime 不应携带 Node LICENSE");
  }
  if (runtime.protocolVersion !== CORE_PROTOCOL_VERSION) {
    fail("runtime.json 缺少 Core Protocol metadata");
  }
  if (!runtime.capabilities) {
    fail("runtime.json 缺少 Core capability metadata");
  }
  const capabilities = runtime.capabilities!;
  if (
    runtime.dataSchema?.database !== DATABASE_SCHEMA_VERSION ||
    runtime.dataSchema.config !== CONFIG_SCHEMA_VERSION
  ) {
    fail("runtime.json data schema metadata 与当前构建不一致");
  }
  if (capabilities.diretta === true && runtime.direttaSdkRelease !== DIRETTA_SDK_RELEASE) {
    fail(
      `runtime.json Diretta SDK release 与正式构建不一致: ${runtime.direttaSdkRelease ?? "unknown"}`,
    );
  }
  if (capabilities.diretta !== true && runtime.direttaSdkRelease != null) {
    fail("runtime.json no-Diretta artifact 不应携带 SDK release");
  }

  const port = await reservePort();
  child = spawn(path.join(installRoot, "bin", "splayer-atom-core"), [], {
    cwd: tempDir,
    env: {
      ...process.env,
      ATOM_NODE_BIN: bundleNode ? "" : process.execPath,
      ATOM_SERVER_PORT: String(port),
      XDG_CACHE_HOME: path.join(tempDir, "cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const info = await waitForJson<CoreInfo>(`${baseUrl}/api/info`).catch((error) =>
    fail(`Core 未能通过 /api/info 启动验收: ${String(error)}\n${output}`),
  );
  if (bundleNode && realpathSync(`/proc/${child.pid}/exe`) !== realpathSync(bundledNode)) {
    fail(`bundled-runtime 未使用包内 Node: ${realpathSync(`/proc/${child.pid}/exe`)}`);
  }
  if (
    info.version !== runtime.atomVersion ||
    info.commit !== runtime.atomCommit ||
    info.sourceDirty !== runtime.sourceDirty ||
    info.direttaSdkRelease !== runtime.direttaSdkRelease ||
    info.node !== CORE_NODE_REFERENCE ||
    info.nodeRange !== CORE_NODE_RANGE ||
    info.nodeReference !== CORE_NODE_REFERENCE ||
    info.protocol.version !== CORE_PROTOCOL_VERSION ||
    JSON.stringify(info.capabilities) !== JSON.stringify(capabilities)
  ) {
    fail(`Core info runtime/protocol contract 不一致: ${JSON.stringify(info)}`);
  }

  await waitForJson(`${baseUrl}/api/session`);
  await waitForJson(`${baseUrl}/api/library/count`);
  await waitForJson(`${baseUrl}/api/cache/stats`);
  const cacheDir = await waitForJson<{ dir?: string }>(`${baseUrl}/api/cache/dir`);
  if (!cacheDir.dir) fail("Core cache dir smoke 失败");
  const web = await fetch(`${baseUrl}/`);
  if (!web.ok || !(await web.text()).includes("<html")) fail("Web Control 根页 smoke 失败");

  child.kill("SIGTERM");
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  if (signal || code !== 0) fail(`Core SIGTERM 退出异常: code=${code} signal=${signal}\n${output}`);
  child = null;

  const settings = JSON.parse(
    readFileSync(path.join(installRoot, "data", "config", "settings.json"), "utf8"),
  ) as { __configVersion?: number };
  if (settings.__configVersion !== CONFIG_SCHEMA_VERSION) {
    fail(`Core settings schema 未初始化到 ${CONFIG_SCHEMA_VERSION}`);
  }
  const stagedRequire = createRequire(path.join(installRoot, "app", "index.js"));
  const StagedDatabase = stagedRequire("better-sqlite3") as typeof import("better-sqlite3");
  const database = new StagedDatabase(path.join(installRoot, "data", "database", "library.db"), {
    readonly: true,
  });
  try {
    const schemaVersion = database.pragma("user_version", { simple: true }) as number;
    if (schemaVersion !== DATABASE_SCHEMA_VERSION) {
      fail(`Core database schema 未初始化到 ${DATABASE_SCHEMA_VERSION}: ${schemaVersion}`);
    }
  } finally {
    database.close();
  }

  console.log(`[CoreArtifact] PASS ${archiveFile}`);
  console.log(
    JSON.stringify({ node: info.node, port, web: true, session: true, library: true, cache: true }),
  );
} finally {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  rmSync(tempDir, { recursive: true, force: true });
}
