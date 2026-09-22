import path from "node:path";
import type { Track } from "@shared/types/player";

export const SACD_VIRTUAL_PATH = /^(.*\.iso)\|Track(\d+)\|/i;

export interface SacdVirtualPath {
  isoPath: string;
  trackNum: number;
}

/** 解析 SACD 虚拟分轨路径；普通 ISO/普通文件返回 null。 */
export const parseSacdVirtualPath = (value: string | undefined): SacdVirtualPath | null => {
  if (!value) return null;
  const match = SACD_VIRTUAL_PATH.exec(value);
  if (!match) return null;
  const trackNum = Number(match[2]);
  if (!Number.isInteger(trackNum) || trackNum <= 0) return null;
  return { isoPath: match[1], trackNum };
};

/** SACD 虚拟分轨 -> 物理 ISO；普通路径返回 null。 */
export const sacdIsoPathFromVirtual = (value: string | undefined): string | null => {
  return parseSacdVirtualPath(value)?.isoPath ?? null;
};

/** 本地 Track 在 Folder Browser 中所属的物理容器/文件。 */
export const localTrackContainerPath = (track: Pick<Track, "path" | "cuePath">): string | null => {
  if (track.cuePath) return path.resolve(track.cuePath);
  const source = sacdIsoPathFromVirtual(track.path);
  if (source) return path.resolve(source);
  return track.path ? path.resolve(track.path) : null;
};
