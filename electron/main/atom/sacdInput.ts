import { fileURLToPath } from "node:url";

export interface SacdPlaybackSource {
  isoPath: string;
  trackNum: number;
}

const SACD_VIRTUAL_PATH = /^(.*\.iso)\|Track(\d+)\|/i;

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
 * native 能直接流式读取 SACD virtual Track。新曲库 path 原样透传；这里只把旧 plain ISO
 * session 同步规范化为 virtual identity，不做任何提取、缓存或临时文件 IO。
 */
export const toNativeSacdPlaybackSource = (
  source: string,
  trackNumHint?: number | null,
  durationMs = 0,
): string | null => {
  const local = localPath(source);
  if (SACD_VIRTUAL_PATH.test(local)) return local;
  const parsed = parseSacdPlaybackSource(local, trackNumHint);
  if (!parsed) return null;
  const duration = Math.max(0, durationMs) / 1000;
  return `${parsed.isoPath}|Track${String(parsed.trackNum).padStart(2, "0")}|${duration.toFixed(3)}|0|0`;
};
