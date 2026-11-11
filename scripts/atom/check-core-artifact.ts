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
import WebSocket from "ws";
import {
  coreArtifactFileName,
  findLatestCoreArtifact,
  formatCoreBuildDate,
  readCoreReleaseMetadata,
  readDirettaCpuVariantFromNativeBuild,
  resolveCoreBuildDate,
  resolveCoreBuildTime,
  type CoreRuntimeFlavor,
} from "./core-artifact-name";
import { DIRETTA_SDK_RELEASE, type DirettaCpuVariant } from "./diretta-sdk";
import { resolveSourceIdentity } from "./sourceIdentity";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = new Set(process.argv.slice(2));
const bundleRuntime = args.delete("--bundle-runtime");
const runtimeArg = [...args].find((arg) => arg.startsWith("--runtime="));
if (runtimeArg) args.delete(runtimeArg);
const runtimeFlavor = (runtimeArg?.slice("--runtime=".length) ?? "node") as CoreRuntimeFlavor;
if (runtimeFlavor !== "node" && runtimeFlavor !== "bun")
  throw new Error(`[CoreArtifact] 未知 runtime: ${runtimeFlavor}`);
if (args.size > 0) throw new Error(`[CoreArtifact] 未知参数: ${[...args].join(" ")}`);
const release = readCoreReleaseMetadata();
const buildDate = resolveCoreBuildDate();
const buildTime = resolveCoreBuildTime();
// 正常由 build-core-system 下发 ATOM_BUILD_TIME，能精确重建文件名；
// 单独运行/跨天复核时退回「取 out/ 下最新的同 flavor 产物」。
const sourceIdentity = resolveSourceIdentity(root);
// 变体来自 native 构建落盘的 build.json，与 stage 用的是同一个来源
const direttaVariant = readDirettaCpuVariantFromNativeBuild(root);
const expectedArchive = sourceIdentity
  ? path.join(
      root,
      "out",
      coreArtifactFileName(
        bundleRuntime,
        release.version,
        sourceIdentity.commit,
        buildDate,
        buildTime,
        direttaVariant,
        runtimeFlavor,
      ),
    )
  : "";
const archiveFile =
  expectedArchive && existsSync(expectedArchive)
    ? expectedArchive
    : findLatestCoreArtifact(root, bundleRuntime, direttaVariant, runtimeFlavor);

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

interface ConnectedControl {
  socket: WebSocket;
  hello: { clients?: number };
}

const connectControl = (url: string): Promise<ConnectedControl> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket hello timeout"));
    }, 5000);
    const onMessage = (payload: WebSocket.RawData): void => {
      try {
        const message = JSON.parse(payload.toString()) as { kind?: string; clients?: number };
        if (message.kind === "hello") {
          clearTimeout(timeout);
          socket.off("error", onError);
          socket.off("close", onClose);
          socket.off("message", onMessage);
          // 连接交给 closeControl 管理；保留 error listener 避免晚到的 socket 错误变成未处理事件。
          socket.on("error", () => {});
          resolve({ socket, hello: message });
        }
      } catch (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      reject(error);
    };
    const onClose = (): void => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("WebSocket closed before hello"));
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });

const closeControl = async (socket: WebSocket | null): Promise<void> => {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  socket.close();
  await once(socket, "close").catch(() => {});
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

  // 归档不再套一层目录：解包出来的就是安装根，`runtime.json` 直接在顶层。
  // 早期产物带 `core-system/` 前缀，部署时还得 strip-components 或手动进目录，
  // 多这一层只是把同一件事说了两遍。
  const installRoot = tempDir;
  const runtime = JSON.parse(readFileSync(path.join(installRoot, "runtime.json"), "utf8")) as {
    productName?: string;
    atomVersion?: string;
    buildDate?: string;
    atomCommit?: string;
    sourceDirty?: boolean;
    nodeRange?: string;
    nodeReference?: string;
    nodeBundled?: boolean;
    bunBundled?: boolean;
    runtime?: { name?: CoreRuntimeFlavor; version?: string; pluginHost?: string };
    protocolVersion?: number;
    dataSchema?: { database?: number; config?: number };
    capabilities?: CoreInfo["capabilities"];
    direttaSdkRelease?: number | null;
    direttaCpuVariant?: DirettaCpuVariant | null;
  };
  if (
    runtime.productName !== "SPlayer Atom" ||
    !runtime.atomVersion ||
    runtime.buildDate !== formatCoreBuildDate(buildDate) ||
    !runtime.atomCommit ||
    typeof runtime.sourceDirty !== "boolean"
  ) {
    fail("runtime.json 缺少 SPlayer Atom release identity metadata");
  }
  if (runtime.nodeRange !== CORE_NODE_RANGE || runtime.nodeReference !== CORE_NODE_REFERENCE) {
    fail("runtime.json 与 Core Node contract 不一致");
  }
  if (runtime.nodeBundled !== (bundleRuntime && runtimeFlavor === "node")) {
    fail("runtime.json nodeBundled 与 artifact 变体不一致");
  }
  if (runtime.bunBundled !== (bundleRuntime && runtimeFlavor === "bun")) {
    fail("runtime.json bunBundled 与 artifact 变体不一致");
  }
  if (
    runtime.runtime?.name !== runtimeFlavor ||
    runtime.runtime.pluginHost !== runtimeFlavor ||
    !runtime.runtime.version
  ) {
    fail("runtime.json 运行时元数据不正确");
  }
  const bundledNode = path.join(installRoot, "runtime", "bin", "node");
  const bundledNodeLicense = path.join(installRoot, "runtime", "LICENSE");
  if ((bundleRuntime && runtimeFlavor === "node") !== existsSync(bundledNode)) {
    fail("runtime/bin/node 与 Node bundled flavor 不一致");
  }
  if ((bundleRuntime && runtimeFlavor === "node") !== existsSync(bundledNodeLicense)) {
    fail("runtime/ LICENSE 与 Node bundled flavor 不一致");
  }
  const bundledBun = path.join(installRoot, "runtime", "bin", "bun");
  const bunMarker = path.join(installRoot, "runtime", "bun");
  const bunNotice = path.join(installRoot, "runtime", "BUN-LICENSE-NOTICE.txt");
  if (
    (runtimeFlavor === "bun") !== existsSync(bunMarker) ||
    (bundleRuntime && runtimeFlavor === "bun") !== existsSync(bundledBun) ||
    (bundleRuntime && runtimeFlavor === "bun") !== existsSync(bunNotice)
  ) {
    fail("Bun runtime marker、可执行文件或许可证提示与 flavor 不一致");
  }
  const runtimeBinary =
    runtimeFlavor === "bun"
      ? bundleRuntime
        ? bundledBun
        : process.env.ATOM_BUN_BIN || "bun"
      : bundleRuntime
        ? bundledNode
        : process.execPath;
  const versionSmoke = spawnSync(runtimeBinary, ["--version"], { encoding: "utf8" });
  if (
    versionSmoke.status !== 0 ||
    versionSmoke.stdout.trim().replace(/^v/, "") !== runtime.runtime?.version
  ) {
    fail("安装包的运行时版本与 runtime.json 不一致");
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
  if (capabilities.diretta === true && !runtime.direttaCpuVariant) {
    fail("runtime.json 缺少 Diretta CPU variant");
  }
  if (capabilities.diretta !== true && runtime.direttaSdkRelease != null) {
    fail("runtime.json no-Diretta artifact 不应携带 SDK release");
  }
  if (capabilities.diretta !== true && runtime.direttaCpuVariant != null) {
    fail("runtime.json no-Diretta artifact 不应携带 CPU variant");
  }

  const port = await reservePort();
  child = spawn(path.join(installRoot, "bin", "splayer-atom-core"), [], {
    cwd: tempDir,
    env: {
      ...process.env,
      ATOM_NODE_BIN: runtimeFlavor === "node" && !bundleRuntime ? process.execPath : "",
      ATOM_BUN_BIN: runtimeFlavor === "bun" && !bundleRuntime ? runtimeBinary : "",
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
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const info = await waitForJson<CoreInfo>(`${baseUrl}/api/info`).catch((error) =>
    fail(`Core 未能通过 /api/info 启动验收: ${String(error)}\n${output}`),
  );
  if (bundleRuntime && realpathSync(`/proc/${child.pid}/exe`) !== realpathSync(runtimeBinary)) {
    fail(`bundled-runtime 未使用包内 ${runtimeFlavor}: ${realpathSync(`/proc/${child.pid}/exe`)}`);
  }
  if (
    info.version !== runtime.atomVersion ||
    info.commit !== runtime.atomCommit ||
    info.sourceDirty !== runtime.sourceDirty ||
    info.direttaSdkRelease !== runtime.direttaSdkRelease ||
    (runtimeFlavor === "node" && info.node !== CORE_NODE_REFERENCE) ||
    info.runtime?.name !== runtimeFlavor ||
    info.runtime?.version !== runtime.runtime?.version ||
    info.nodeRange !== CORE_NODE_RANGE ||
    info.nodeReference !== CORE_NODE_REFERENCE ||
    info.protocol.version !== CORE_PROTOCOL_VERSION ||
    JSON.stringify(info.capabilities) !== JSON.stringify(capabilities)
  ) {
    fail(`Core info runtime/protocol contract 不一致: ${JSON.stringify(info)}`);
  }
  if (runtimeFlavor === "bun") {
    const ipcSmoke = spawnSync(runtimeBinary, ["scripts/atom/check-bun-plugin-ipc.ts"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ATOM_PLUGIN_HOST_ENTRY: path.join(installRoot, "app", "plugin-host.js"),
      },
    });
    if (ipcSmoke.status !== 0 || ipcSmoke.signal) {
      fail(`Bun 插件 Host IPC 验收失败: ${ipcSmoke.stderr ?? ""}${ipcSmoke.stdout ?? ""}`);
    }
  }

  await waitForJson(`${baseUrl}/api/session`);
  await waitForJson(`${baseUrl}/api/library/count`);
  await waitForJson(`${baseUrl}/api/cache/stats`);
  const cacheDir = await waitForJson<{ dir?: string }>(`${baseUrl}/api/cache/dir`);
  if (!cacheDir.dir) fail("Core cache dir smoke 失败");
  const web = await fetch(`${baseUrl}/`);
  if (!web.ok || !(await web.text()).includes("<html")) fail("Web Control 根页 smoke 失败");

  let firstControl: WebSocket | null = null;
  let secondControl: WebSocket | null = null;
  let reconnectedControl: WebSocket | null = null;
  try {
    const first = await connectControl(wsUrl);
    firstControl = first.socket;
    if (first.hello.clients !== 1) fail(`首个 Web Control hello 计数异常: ${first.hello.clients}`);
    const second = await connectControl(wsUrl);
    secondControl = second.socket;
    const secondHello = second.hello;
    if (secondHello.clients !== 2)
      fail(`第二个 Web Control hello 计数异常: ${secondHello.clients}`);
    await closeControl(firstControl);
    firstControl = null;
    const reconnected = await connectControl(wsUrl);
    reconnectedControl = reconnected.socket;
    const reconnectHello = reconnected.hello;
    if (reconnectHello.clients !== 2) {
      fail(`Web Control 重连 hello 计数异常: ${reconnectHello.clients}`);
    }
  } finally {
    await closeControl(firstControl);
    await closeControl(secondControl);
    await closeControl(reconnectedControl);
  }

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

  // 用同一份 data 重启一次，覆盖升级后最容易遗漏的持久化与 Web reconnect 路径。
  const restarted = spawn(path.join(installRoot, "bin", "splayer-atom-core"), [], {
    cwd: tempDir,
    env: {
      ...process.env,
      ATOM_NODE_BIN: runtimeFlavor === "node" && !bundleRuntime ? process.execPath : "",
      ATOM_BUN_BIN: runtimeFlavor === "bun" && !bundleRuntime ? runtimeBinary : "",
      ATOM_SERVER_PORT: String(port),
      XDG_CACHE_HOME: path.join(tempDir, "cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let restartOutput = "";
  restarted.stdout?.on("data", (chunk) => {
    restartOutput += chunk.toString();
  });
  restarted.stderr?.on("data", (chunk) => {
    restartOutput += chunk.toString();
  });
  try {
    await waitForJson(`${baseUrl}/api/info`).catch((error) =>
      fail(`Core 重启后未能通过 /api/info: ${String(error)}\n${restartOutput}`),
    );
    await waitForJson(`${baseUrl}/api/session`).catch((error) =>
      fail(`Core 重启后 session smoke 失败: ${String(error)}\n${restartOutput}`),
    );
    if (restarted.exitCode === null && restarted.signalCode === null) restarted.kill("SIGTERM");
    const [restartCode, restartSignal] =
      restarted.exitCode !== null || restarted.signalCode !== null
        ? [restarted.exitCode, restarted.signalCode]
        : ((await once(restarted, "exit")) as [number | null, NodeJS.Signals | null]);
    if (restartSignal || restartCode !== 0) {
      fail(
        `Core 重启后的 SIGTERM 退出异常: code=${restartCode} signal=${restartSignal}\n${restartOutput}`,
      );
    }
  } finally {
    if (restarted.exitCode === null) restarted.kill("SIGKILL");
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
    JSON.stringify({
      runtime: info.runtime,
      port,
      web: true,
      session: true,
      library: true,
      cache: true,
    }),
  );
} finally {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  rmSync(tempDir, { recursive: true, force: true });
}
