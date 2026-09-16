import path from "node:path";
import type { Artist } from "@shared/types/player";

export interface CueTrackInfo {
  title: string;
  artists: Artist[];
  album?: { name: string; artist?: string };
  track: number;
  path: string;
  cuePath: string;
  cueAudioPath: string;
  cueStartMs: number;
  cueEndMs: number;
  cueStartFrame75: number;
  cueEndFrame75?: number;
  duration: number;
}

interface CueFile {
  path: string;
  tracks: ParsedCueTrack[];
}

interface ParsedCueTrack {
  number: number;
  title?: string;
  performer?: string;
  index01Frame75?: number;
}

interface CueSheetState {
  albumTitle?: string;
  albumPerformer?: string;
  files: CueFile[];
}

const commandPattern = /^\s*([A-Z0-9]+)\s*(.*)$/i;

/** 生成 CUE 分轨在库中的稳定虚拟路径 */
export const toCueTrackPath = (cuePath: string, trackNumber: number): string =>
  `cue://${cuePath}#track=${trackNumber.toString().padStart(2, "0")}`;

/**
 * 从 CUE 虚拟路径中提取真实的 CUE 文件路径
 * @param cueTrackPath - 虚拟路径，格式为 `cue://{cuePath}#track={number}`
 * @returns 真实的 CUE 文件路径，格式不匹配时返回 null
 */
export const extractCuePath = (cueTrackPath: string): string | null => {
  const match = cueTrackPath.match(/^cue:\/\/(.+)#track=\d+$/);
  return match?.[1] ?? null;
};

/** 从 CUE 命令参数中取第一个字段，支持双引号包裹的值 */
const readToken = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed.split(/\s+/)[0] ?? "";
  let token = "";
  for (let i = 1; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '"') break;
    token += char;
  }
  return token;
};

/** 解析 mm:ss:ff 为 CUE 原始 75fps 整数帧。 */
const parseIndexFrame75 = (value: string): number | null => {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frames = Number(match[3]);
  if (!Number.isFinite(minutes) || seconds > 59 || frames > 74) return null;
  return (minutes * 60 + seconds) * 75 + frames;
};

const cueFrame75ToMs = (frame: number): number => Math.round((frame * 1000) / 75);

/** 解析 CUE 文本为内部结构 */
const parseState = (content: string): CueSheetState => {
  const state: CueSheetState = { files: [] };
  let currentFile: CueFile | null = null;
  let currentTrack: ParsedCueTrack | null = null;

  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = rawLine.match(commandPattern);
    if (!match) continue;
    const command = match[1].toUpperCase();
    const value = match[2] ?? "";

    if (command === "FILE") {
      currentFile = { path: readToken(value), tracks: [] };
      state.files.push(currentFile);
      currentTrack = null;
      continue;
    }

    if (command === "TRACK") {
      const number = Number(value.trim().split(/\s+/)[0]);
      if (!currentFile || !Number.isFinite(number)) continue;
      currentTrack = { number };
      currentFile.tracks.push(currentTrack);
      continue;
    }

    if (command === "TITLE") {
      const title = readToken(value);
      if (currentTrack) currentTrack.title = title;
      else state.albumTitle = title;
      continue;
    }

    if (command === "PERFORMER") {
      const performer = readToken(value);
      if (currentTrack) currentTrack.performer = performer;
      else state.albumPerformer = performer;
      continue;
    }

    if (command === "INDEX" && currentTrack) {
      const parts = value.trim().split(/\s+/);
      if (parts[0] !== "01") continue;
      const frame = parseIndexFrame75(parts[1] ?? "");
      if (frame != null) currentTrack.index01Frame75 = frame;
    }
  }

  return state;
};

/**
 * 读取单文件 CUE 指向的真实音频路径。
 * @param content - CUE 文件内容
 * @param cuePath - CUE 文件路径
 */
export const getCueAudioPath = (content: string, cuePath: string): string | null => {
  const state = parseState(content);
  if (state.files.length !== 1) return null;
  return path.resolve(path.dirname(cuePath), state.files[0].path);
};

/**
 * 解析单文件 CUE。
 * @param content - CUE 文件内容
 * @param cuePath - CUE 文件路径
 * @param audioDurationMs - 真实音频总时长
 */
export const parseCueSheet = (
  content: string,
  cuePath: string,
  audioDurationMs: number,
): CueTrackInfo[] => {
  const state = parseState(content);
  if (state.files.length !== 1 || audioDurationMs <= 0) return [];
  const file = state.files[0];
  const audioPath = path.resolve(path.dirname(cuePath), file.path);
  const indexedTracks = file.tracks
    .filter((track) => track.index01Frame75 != null)
    .sort((a, b) => (a.index01Frame75 ?? 0) - (b.index01Frame75 ?? 0));

  return indexedTracks
    .map((track, index): CueTrackInfo | null => {
      const startFrame75 = track.index01Frame75 ?? 0;
      const nextStartFrame75 = indexedTracks[index + 1]?.index01Frame75;
      const start = cueFrame75ToMs(startFrame75);
      const nextStart =
        nextStartFrame75 == null ? audioDurationMs : cueFrame75ToMs(nextStartFrame75);
      const end = Math.min(audioDurationMs, nextStart);
      if (end <= start) return null;
      const performer = track.performer || state.albumPerformer || "";
      const artists = performer ? [{ name: performer }] : [];
      const album = state.albumTitle
        ? { name: state.albumTitle, artist: state.albumPerformer }
        : undefined;
      return {
        title: track.title || `${path.basename(cuePath, path.extname(cuePath))} #${track.number}`,
        artists,
        album,
        track: track.number,
        path: toCueTrackPath(cuePath, track.number),
        cuePath,
        cueAudioPath: audioPath,
        cueStartMs: start,
        cueEndMs: end,
        cueStartFrame75: startFrame75,
        cueEndFrame75: nextStartFrame75,
        duration: end - start,
      };
    })
    .filter((track): track is CueTrackInfo => track !== null);
};
