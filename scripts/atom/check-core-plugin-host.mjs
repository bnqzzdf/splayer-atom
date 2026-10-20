import { existsSync } from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const entry = path.join(root, "out", "core", "plugin-host.js");
if (!existsSync(entry)) {
  throw new Error(`[CorePluginHost] build output 不存在: ${entry}`);
}

const child = fork(entry, [], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  // 与 core/atom/runtime/pluginHost.ts 保持一致，验证权限模型下 host 仍能正常握手
  execArgv: ["--permission", `--allow-fs-read=${path.dirname(entry)}`],
});
let output = "";
let ready = false;
let pong = false;
child.stdout?.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr?.on("data", (chunk) => {
  output += chunk.toString();
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(new Error(`[CorePluginHost] hostReady/pong 超时${output ? `\n${output}` : ""}`));
  }, 5000);

  child.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.kind === "hostReady" && !ready) {
      ready = true;
      child.send({ kind: "ping" });
      return;
    }
    if (message.kind === "pong" && ready) {
      pong = true;
      child.kill("SIGTERM");
    }
  });

  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    if (!pong) {
      reject(
        new Error(
          `[CorePluginHost] 未完成 hostReady/pong: code=${code} signal=${signal}${output ? `\n${output}` : ""}`,
        ),
      );
      return;
    }
    resolve(undefined);
  });
});

console.log("[CorePluginHost] PASS hostReady -> ping -> pong");
