import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const syscallFilter = (): Buffer => {
  // clone3 返回 ENOSYS 让 Bun/线程库退回 clone；只允许 CLONE_THREAD，不允许创建进程。
  // 同时拒绝 x32 syscall 编号，避免绕过 x86-64 的 fork/clone 过滤。
  const instructions: Array<[number, number, number, number]> = [
    [0x20, 0, 0, 4],
    [0x15, 1, 0, 0xc000003e],
    [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0],
    [0x45, 0, 1, 0x40000000],
    [0x06, 0, 0, 0x80000000],
    [0x15, 0, 1, 57],
    [0x06, 0, 0, 0x00050001],
    [0x15, 0, 1, 58],
    [0x06, 0, 0, 0x00050001],
    [0x15, 0, 1, 435],
    [0x06, 0, 0, 0x00050026],
    [0x15, 0, 3, 56],
    [0x20, 0, 0, 16],
    [0x45, 1, 0, 0x00010000],
    [0x06, 0, 0, 0x00050001],
    [0x06, 0, 0, 0x7fff0000],
  ];
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, value], index) => {
    const offset = index * 8;
    buffer.writeUInt16LE(code, offset);
    buffer.writeUInt8(jt, offset + 2);
    buffer.writeUInt8(jf, offset + 3);
    buffer.writeUInt32LE(value, offset + 4);
  });
  return buffer;
};

export const spawnSandboxedBunPluginHost = (entry: string) => {
  if (process.platform !== "linux" || process.arch !== "x64" || !process.versions.bun) {
    throw new Error("Sandboxed Bun plugin host requires Bun on Linux x86-64");
  }
  const bwrap = process.env.ATOM_BWRAP_BIN || "/usr/bin/bwrap";
  if (!existsSync(bwrap)) throw new Error(`Bun plugin sandbox requires bubblewrap: ${bwrap}`);
  const bun = realpathSync(process.execPath);
  const coreDir = realpathSync(path.dirname(entry));
  const temp = mkdtempSync(path.join(os.tmpdir(), "atom-plugin-seccomp-"));
  const filterPath = path.join(temp, "filter.bpf");
  let filterFd = -1;
  try {
    writeFileSync(filterPath, syscallFilter(), { mode: 0o600 });
    filterFd = openSync(filterPath, "r");
    const child = spawn(
      bwrap,
      [
        "--unshare-all",
        "--unshare-user",
        "--disable-userns",
        "--die-with-parent",
        "--new-session",
        "--clearenv",
        "--setenv", "NODE_CHANNEL_FD", "3",
        "--setenv", "NODE_CHANNEL_SERIALIZATION_MODE", "json",
        "--setenv", "ATOM_PLUGIN_IPC_JSON", "1",
        "--setenv", "HOME", "/tmp",
        "--setenv", "PATH", "/runtime",
        "--setenv", "NODE_ENV", "production",
        "--dir", "/usr",
        "--ro-bind-try", "/usr/lib", "/usr/lib",
        "--ro-bind-try", "/usr/lib64", "/usr/lib64",
        "--ro-bind-try", "/lib", "/lib",
        "--ro-bind-try", "/lib64", "/lib64",
        "--dir", "/runtime",
        "--ro-bind", bun, "/runtime/bun",
        "--ro-bind", coreDir, "/app",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--chdir", "/app",
        "--seccomp", "4",
        "/runtime/bun", `/app/${path.basename(entry)}`,
      ],
      { stdio: ["ignore", "pipe", "pipe", "ipc", filterFd], serialization: "json" },
    );
    return child;
  } finally {
    if (filterFd !== -1) closeSync(filterFd);
    rmSync(temp, { recursive: true, force: true });
  }
};
