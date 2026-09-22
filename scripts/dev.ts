#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("SPlayer Atom 开发运行时当前只支持 Linux x86-64");
}

const root = fileURLToPath(new URL("..", import.meta.url));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
  ATOM_APP_NAME: "SPlayer Atom Core",
  ATOM_APP_PACKAGED: "0",
  ATOM_LOG_STDIO_ONLY: "1",
  ATOM_NATIVE_DIR: path.join(root, "out", "native"),
  ATOM_WEB_DEV_URL: process.env.ATOM_WEB_DEV_URL ?? "http://127.0.0.1:5173",
};

const children: ChildProcess[] = [];
let stopping = false;

const start = (command: string, args: string[]): ChildProcess => {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`[dev] ${command} 启动失败`, error);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${command} 已退出: ${signal ?? code ?? "unknown"}`);
    stop(code ?? 1);
  });
  return child;
};

const stop = (exitCode = 0): void => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
};

start(path.join(root, "node_modules", ".bin", "tsx"), [
  "watch",
  "--tsconfig",
  "tsconfig.node.json",
  "core/core-node/index.ts",
]);
start(path.join(root, "node_modules", ".bin", "vite"), ["--config", "vite.config.ts"]);

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
