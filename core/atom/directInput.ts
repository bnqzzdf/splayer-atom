import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeExactHttpInput } from "@main/atom/exactInput";
import { playerLog } from "@main/utils/logger";

interface InFlightMaterialization {
  controller: AbortController;
  promise: Promise<string>;
}

const inFlight = new Map<string, InFlightMaterialization>();

const tempRoot = (): string =>
  path.join(os.tmpdir(), "splayer-atom-direct-input", String(process.pid));

const extensionForSource = (source: string): string => {
  try {
    const ext = path.extname(new URL(source).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  } catch {}
  return ".audio";
};

const materializedPath = (source: string): string => {
  const hash = crypto.createHash("sha1").update(source).digest("hex").slice(0, 20);
  return path.join(tempRoot(), `${hash}${extensionForSource(source)}`);
};

const isReusable = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
};

/**
 * 把远端音频按响应字节原样落成本地 seekable 临时文件。
 * 不解码、不转码、不修改 payload，仅为 strict Direct 提供本地文件语义。
 * @param source - 已解析出的 HTTP(S) 音频 URL
 * @returns 进程级临时文件绝对路径
 */
export const materializeDirectInput = async (source: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Direct input materialization 仅接受 HTTP(S) 音源");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Direct input materialization 仅接受 HTTP(S) 音源");
  }

  const finalPath = materializedPath(source);
  if (await isReusable(finalPath)) return finalPath;

  const existing = inFlight.get(source);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = writeExactHttpInput(source, finalPath, controller.signal)
    .then(({ format }) => {
      playerLog.debug(`Direct 在线输入格式探测: ${format} (${source})`);
      return finalPath;
    })
    .finally(() => inFlight.delete(source));
  inFlight.set(source, { controller, promise });
  return promise;
};

/**
 * 删除一个已经确认不可用的 Direct 临时输入。
 * 非本模块临时目录中的路径不会被删除。
 * @param filePath - player load 失败的本地 source
 */
export const discardDirectInput = async (filePath: string): Promise<void> => {
  const root = path.resolve(tempRoot());
  const candidate = path.resolve(filePath);
  if (!candidate.startsWith(`${root}${path.sep}`)) return;
  await fsp.rm(candidate, { force: true }).catch(() => {});
};

/**
 * 清理已经不再是当前播放源的 Direct 临时文件。
 * @param keepPath - 当前 load 成功后的 source；若不属于 Direct 临时目录则全部清理
 */
export const pruneDirectInputs = async (keepPath: string): Promise<void> => {
  let entries: fs.Dirent[];
  try {
    // 必须在第一次 await 前固定本轮清理集合：boundary 提交后会立即启动下一首 preload，
    // 后启动/后完成的 staged 文件不能被上一轮异步 prune 误删。
    entries = fs.readdirSync(tempRoot(), { withFileTypes: true });
  } catch {
    return;
  }
  const keep = path.resolve(keepPath);
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || entry.name.endsWith(".part")) return;
      const filePath = path.resolve(tempRoot(), entry.name);
      if (filePath === keep) return;
      await fsp.rm(filePath, { force: true }).catch(() => {});
    }),
  );
};

/** 清理本进程产生的 Direct 临时输入，并取消尚未完成的下载。 */
export const cleanupDirectInputs = async (): Promise<void> => {
  const pending = [...inFlight.values()];
  for (const entry of pending) entry.controller.abort();
  await Promise.allSettled(pending.map((entry) => entry.promise));
  await fsp.rm(tempRoot(), { recursive: true, force: true });
};
