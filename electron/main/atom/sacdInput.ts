import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEngine } from "@main/services/engine";

export interface SacdPlaybackSource {
  isoPath: string;
  trackNum: number;
}

export interface PreparedSacdInput {
  filePath: string;
  durationMs: number;
}

const SACD_VIRTUAL_PATH = /^(.*\.iso)\|Track(\d+)\|/i;

const tempRoot = (): string =>
  path.join(os.tmpdir(), "splayer-atom-sacd-input", String(process.pid));

const localPath = (source: string): string =>
  source.startsWith("file:") ? fileURLToPath(source) : source;

/** 解析曲库 SACD 虚拟分轨；plain ISO 可用 canonical track number 作为兼容输入。 */
export const parseSacdPlaybackSource = (
  source: string,
  trackNumHint?: number | null,
): SacdPlaybackSource | null => {
  const local = localPath(source);
  const virtual = SACD_VIRTUAL_PATH.exec(local);
  if (virtual) {
    const trackNum = Number(virtual[2]);
    return Number.isInteger(trackNum) && trackNum > 0 ? { isoPath: virtual[1], trackNum } : null;
  }
  if (!/\.iso$/i.test(local)) return null;
  const trackNum = trackNumHint ?? 1;
  return Number.isInteger(trackNum) && trackNum > 0 ? { isoPath: local, trackNum } : null;
};

/**
 * 把一个 SACD stereo 虚拟轨准备成真实 DSF 文件，供 ALSA 与 Diretta 共用 native load seam。
 * DST 只做无损解压，logical DSD sequence 由既有 media_extract correctness gate 保证。
 */
export const prepareSacdPlaybackInput = async (
  source: SacdPlaybackSource,
): Promise<PreparedSacdInput> => {
  await fsp.mkdir(tempRoot(), { recursive: true });
  const filePath = path.join(tempRoot(), `${crypto.randomUUID()}.dsf`);
  try {
    const result = await getEngine().extractSacdDsf(source.isoPath, source.trackNum, filePath);
    return { filePath, durationMs: Math.max(0, result.durationMs) };
  } catch (error) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    await fsp.rm(`${filePath}.part`, { force: true }).catch(() => {});
    throw error;
  }
};

export const isSacdPlaybackInput = (filePath: string): boolean => {
  const root = path.resolve(tempRoot());
  const candidate = path.resolve(filePath);
  return candidate.startsWith(`${root}${path.sep}`);
};

/** 删除一个尚未进入或已经退出 native playback 的 Atom SACD 临时输入。 */
export const discardSacdPlaybackInput = async (filePath: string): Promise<void> => {
  if (!isSacdPlaybackInput(filePath)) return;
  await fsp.rm(filePath, { force: true }).catch(() => {});
  await fsp.rm(`${filePath}.part`, { force: true }).catch(() => {});
};

/** 保留当前 native SACD 输入并清理同进程旧轨；非 managed keepPath 表示全部清理。 */
export const pruneSacdPlaybackInputs = async (keepPath: string): Promise<void> => {
  let names: string[];
  try {
    names = await fsp.readdir(tempRoot());
  } catch {
    return;
  }
  const keep = path.resolve(keepPath);
  await Promise.all(
    names.map(async (name) => {
      if (!name.endsWith(".dsf")) return;
      const filePath = path.resolve(tempRoot(), name);
      if (filePath === keep) return;
      await fsp.rm(filePath, { force: true }).catch(() => {});
    }),
  );
};

/** Core 退出时尽力清理本进程 SACD 生成输入。 */
export const cleanupSacdPlaybackInputs = async (): Promise<void> => {
  await fsp.rm(tempRoot(), { recursive: true, force: true }).catch(() => {});
};
