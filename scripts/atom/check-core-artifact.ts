import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { CORE_NODE_RANGE, CORE_NODE_REFERENCE } from "../../electron/main/atom/runtime/nodeRuntime";
import { CORE_PROTOCOL_VERSION } from "../../shared/constants/coreProtocol";
import type { CoreInfo } from "../../shared/types/core";

const root = fileURLToPath(new URL("../..", import.meta.url));
const archiveFile = path.join(root, "out", "core-system-linux-x64.tar.gz");

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
    nodeRange?: string;
    nodeReference?: string;
    protocolVersion?: number;
    capabilities?: CoreInfo["capabilities"];
  };
  if (runtime.nodeRange !== CORE_NODE_RANGE || runtime.nodeReference !== CORE_NODE_REFERENCE) {
    fail("runtime.json 与 Core Node contract 不一致");
  }
  if (runtime.protocolVersion !== CORE_PROTOCOL_VERSION || !runtime.capabilities) {
    fail("runtime.json 缺少 Core Protocol/capability metadata");
  }

  const port = await reservePort();
  child = spawn(path.join(installRoot, "bin", "splayer-atom-core"), [], {
    cwd: installRoot,
    env: {
      ...process.env,
      ATOM_NODE_BIN: process.execPath,
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
  if (
    info.node !== CORE_NODE_REFERENCE ||
    info.nodeRange !== CORE_NODE_RANGE ||
    info.nodeReference !== CORE_NODE_REFERENCE ||
    info.protocol.version !== CORE_PROTOCOL_VERSION ||
    JSON.stringify(info.capabilities) !== JSON.stringify(runtime.capabilities)
  ) {
    fail(`Core info runtime/protocol contract 不一致: ${JSON.stringify(info)}`);
  }

  await waitForJson(`${baseUrl}/api/session`);
  await waitForJson(`${baseUrl}/api/library/count`);
  const web = await fetch(`${baseUrl}/`);
  if (!web.ok || !(await web.text()).includes("<html")) fail("Web Control 根页 smoke 失败");

  child.kill("SIGTERM");
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  if (signal || code !== 0) fail(`Core SIGTERM 退出异常: code=${code} signal=${signal}\n${output}`);
  child = null;

  console.log(`[CoreArtifact] PASS ${archiveFile}`);
  console.log(JSON.stringify({ node: info.node, port, web: true, session: true, library: true }));
} finally {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  rmSync(tempDir, { recursive: true, force: true });
}
