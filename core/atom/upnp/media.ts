import crypto from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { writeExactHttpInput } from "@main/atom/exactInput";
import { parseSacdPlaybackSource } from "@main/atom/sacdInput";
import { getEngine } from "@main/services/engine";
import type { AudioQuality, PlaybackQueueItem } from "@shared/types/player";

export interface UpnpMediaResource {
  id: string;
  url: string;
  filePath: string;
  mime: string;
  size: number;
  title: string;
  durationMs: number;
  deleteOnRelease: boolean;
}

export interface PreparedUpnpMedia {
  filePath: string;
  durationMs: number;
  quality?: AudioQuality;
  mime: string;
  deleteOnRelease: boolean;
}

export interface UpnpPreparationSource {
  source: string;
}

interface RegisterMediaOptions {
  rendererHost: string;
  title: string;
  durationMs?: number;
  mime?: string;
  deleteOnRelease?: boolean;
}

const resources = new Map<string, UpnpMediaResource>();
let server: http.Server | null = null;
let port = 0;

const inputTempRoot = (): string =>
  path.join(os.tmpdir(), "splayer-atom-upnp-input", String(process.pid));

const generatedTempRoot = (): string =>
  path.join(os.tmpdir(), "splayer-atom-upnp-generated", String(process.pid));

const extensionForSource = (source: string): string => {
  try {
    const ext = path.extname(new URL(source).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  } catch {}
  return ".audio";
};

const mimeForPath = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".flac":
      return "audio/flac";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".aac":
      return "audio/aac";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".dsf":
      return "audio/x-dsf";
    case ".dff":
    case ".dsdiff":
      return "audio/x-dff";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".ape":
      return "audio/ape";
    default:
      return "application/octet-stream";
  }
};

/** 优先相信真实容器扩展；缓存/.audio 无扩展语义时才使用已有 Track codec 提示。 */
export const inferUpnpMime = (filePath: string, codec?: string): string => {
  const byPath = mimeForPath(filePath);
  if (byPath !== "application/octet-stream") return byPath;
  const normalized = codec?.trim().toLowerCase() ?? "";
  if (normalized === "flac") return "audio/flac";
  if (normalized === "mp3") return "audio/mpeg";
  if (normalized === "aac") return "audio/aac";
  if (normalized === "alac") return "audio/mp4";
  if (normalized === "dsd_dsf") return "audio/x-dsf";
  if (normalized === "dsd_dff") return "audio/x-dff";
  if (normalized === "opus" || normalized === "vorbis") return "audio/ogg";
  if (normalized === "ape") return "audio/ape";
  if (normalized.startsWith("pcm_")) return "audio/wav";
  return "application/octet-stream";
};

const fallbackLanAddress = (): string | null => {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
};

const localAddressFor = (rendererHost: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const finish = (error?: Error): void => {
      try {
        socket.close();
      } catch {}
      if (error) reject(error);
    };
    socket.once("error", finish);
    socket.connect(9, rendererHost, () => {
      const address = socket.address();
      const selected = typeof address === "object" ? address.address : null;
      try {
        socket.close();
      } catch {}
      const fallback = fallbackLanAddress();
      if (selected && selected !== "0.0.0.0") resolve(selected);
      else if (fallback) resolve(fallback);
      else reject(new Error("无法确定 Renderer 可达的本机 IPv4 地址"));
    });
  });

interface ByteRange {
  start: number;
  end: number;
}

const parseRange = (header: string | undefined, size: number): ByteRange | "invalid" | null => {
  if (!header || !header.startsWith("bytes=") || header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  if (!match[1] && !match[2]) return "invalid";

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: Math.max(0, size - 1) };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size) {
    return "invalid";
  }
  const end = Math.min(requestedEnd, size - 1);
  if (end < start) return "invalid";
  return { start, end };
};

const sendResource = async (
  request: IncomingMessage,
  response: ServerResponse,
  resource: UpnpMediaResource,
): Promise<void> => {
  const stat = await fsp.stat(resource.filePath);
  const size = stat.size;
  const range = parseRange(request.headers.range, size);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", resource.mime);

  if (range === "invalid") {
    response.statusCode = 416;
    response.setHeader("Content-Range", `bytes */${size}`);
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, size - 1);
  const length = size === 0 ? 0 : end - start + 1;
  response.statusCode = range ? 206 : 200;
  response.setHeader("Content-Length", length);
  if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  if (request.method === "HEAD" || size === 0) {
    response.end();
    return;
  }

  const stream = fs.createReadStream(resource.filePath, { start, end });
  try {
    await pipeline(stream, response);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (
      code === "ERR_STREAM_PREMATURE_CLOSE" ||
      request.aborted ||
      request.destroyed ||
      response.destroyed
    ) {
      return;
    }
    throw error;
  }
};

const handleRequest = (request: IncomingMessage, response: ServerResponse): void => {
  void (async () => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://upnp.local");
    const match = /^\/media\/([^/]+)$/.exec(url.pathname);
    const resource = match ? resources.get(decodeURIComponent(match[1])) : null;
    if (!resource) {
      response.statusCode = 404;
      response.end();
      return;
    }
    try {
      await sendResource(request, response, resource);
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  })();
};

const ensureServer = (): Promise<number> => {
  if (server && port > 0) return Promise.resolve(port);
  return new Promise((resolve, reject) => {
    const next = http.createServer(handleRequest);
    const fail = (error: Error): void => {
      next.close();
      reject(error);
    };
    next.once("error", fail);
    next.listen(0, "0.0.0.0", () => {
      next.off("error", fail);
      const address = next.address();
      if (!address || typeof address === "string") {
        next.close();
        reject(new Error("UPnP media listener 未取得 TCP 端口"));
        return;
      }
      server = next;
      port = address.port;
      next.unref();
      resolve(port);
    });
  });
};

const stopServerIfIdle = async (): Promise<void> => {
  if (resources.size > 0 || !server) return;
  const current = server;
  server = null;
  port = 0;
  await new Promise<void>((resolve) => current.close(() => resolve()));
};

/** 对 Renderer 实际拉取的本地文件读取真实编码参数；失败时由调用方回退 canonical metadata。 */
export const probeUpnpMediaQuality = async (filePath: string): Promise<AudioQuality | null> => {
  try {
    const quality = await getEngine().probeMediaQuality(filePath);
    if (!quality.codec || quality.sampleRate <= 0 || quality.channels <= 0) return null;
    return {
      codec: quality.codec,
      sampleRate: quality.sampleRate,
      channels: quality.channels,
      bitsPerSample: quality.bitsPerSample,
      bitRate: quality.bitRate,
    };
  } catch {
    return null;
  }
};

export const upnpCueTrackNumber = (item: PlaybackQueueItem): number | null => {
  if (!item.track.cuePath) return null;
  const value = item.track.track;
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : null;
};

export const isUpnpDsdCueTrack = (item: PlaybackQueueItem): boolean => {
  const codec = item.track.quality?.codec?.toLowerCase() ?? "";
  const source = item.track.cueAudioPath?.toLowerCase() ?? "";
  return codec === "dsd_dsf" || codec === "dsd_dff" || /\.(?:dsf|dff|dsdiff)$/.test(source);
};

export const isUpnpIntegerLosslessCueTrack = (item: PlaybackQueueItem): boolean => {
  const codec = item.track.quality?.codec?.toLowerCase() ?? "";
  return /^(?:flac|ape|alac|wavpack|tta|shorten|pcm_[su])/.test(codec);
};

/**
 * 把一首 canonical Track 准备成 Renderer 最终会拉取的本地媒体表示。
 * 这里只做 Core 侧文件工作，不注册资源、不扫描 Renderer、不发送任何 AVTransport 命令。
 */
export const prepareUpnpPlaybackMedia = async (
  item: PlaybackQueueItem,
  resolved: UpnpPreparationSource,
): Promise<PreparedUpnpMedia> => {
  const track = item.track;
  if (track.quality?.channels && track.quality.channels !== 2) {
    throw new Error("UPnP output currently supports stereo only");
  }
  let filePath: string;
  let durationMs = track.duration;
  let deleteOnRelease = false;
  let ownedPath: string | null = null;
  const cueNum = upnpCueTrackNumber(item);
  const sacd = parseSacdPlaybackSource(resolved.source, track.track);

  try {
    if (track.cuePath) {
      if (cueNum == null) throw new Error("UPnP CUE track number is unavailable");
      if (!isUpnpDsdCueTrack(item) && !isUpnpIntegerLosslessCueTrack(item)) {
        throw new Error("UPnP CUE requires integer lossless PCM or native DSD source");
      }
      const generated = isUpnpDsdCueTrack(item)
        ? await extractUpnpCueDsf(track.cuePath, cueNum)
        : await extractUpnpCueWav(track.cuePath, cueNum);
      filePath = generated.filePath;
      durationMs = generated.durationMs;
      deleteOnRelease = true;
      ownedPath = filePath;
    } else if (/\.iso(?:$|\|Track\d+\|)/i.test(resolved.source)) {
      if (!sacd) throw new Error("UPnP SACD track identity is unavailable");
      const generated = await extractUpnpSacdDsf(sacd.isoPath, sacd.trackNum);
      filePath = generated.filePath;
      durationMs = generated.durationMs;
      deleteOnRelease = true;
      ownedPath = filePath;
    } else if (/^https?:\/\//i.test(resolved.source)) {
      filePath = await materializeUpnpInput(resolved.source);
      deleteOnRelease = true;
      ownedPath = filePath;
    } else {
      filePath = resolved.source.startsWith("file:")
        ? fileURLToPath(resolved.source)
        : resolved.source;
    }

    const quality = (await probeUpnpMediaQuality(filePath)) ?? track.quality;
    return {
      filePath,
      durationMs,
      quality,
      mime: inferUpnpMime(filePath, quality?.codec ?? track.quality?.codec),
      deleteOnRelease,
    };
  } catch (error) {
    if (ownedPath) await discardUpnpInput(ownedPath);
    throw error;
  }
};

/** 释放尚未交给 media resource 的 prepared media；用户原始本地文件永不删除。 */
export const discardPreparedUpnpMedia = async (media: PreparedUpnpMedia | null): Promise<void> => {
  if (!media?.deleteOnRelease) return;
  await discardUpnpInput(media.filePath);
};

/** 注册一个已经准备完成的本地媒体文件并返回 Renderer 可访问 URL。 */
export const registerMediaFile = async (
  filePath: string,
  options: RegisterMediaOptions,
): Promise<UpnpMediaResource> => {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error(`UPnP 媒体不是普通文件: ${filePath}`);
  const host = await localAddressFor(options.rendererHost);
  const selectedPort = await ensureServer();
  const id = crypto.randomUUID();
  const resource: UpnpMediaResource = {
    id,
    url: `http://${host}:${selectedPort}/media/${encodeURIComponent(id)}`,
    filePath,
    mime: options.mime ?? inferUpnpMime(filePath),
    size: stat.size,
    title: options.title,
    durationMs: Math.max(0, options.durationMs ?? 0),
    deleteOnRelease: options.deleteOnRelease === true,
  };
  resources.set(id, resource);
  return resource;
};

/** 为 UPnP 把远端音源完整物化到独立临时目录；文件生命周期由 media resource 接管。 */
export const materializeUpnpInput = async (source: string): Promise<string> => {
  const filePath = path.join(
    inputTempRoot(),
    `${crypto.randomUUID()}${extensionForSource(source)}`,
  );
  await writeExactHttpInput(source, filePath);
  return filePath;
};

export interface UpnpGeneratedInput {
  filePath: string;
  durationMs: number;
}

/** CUE 使用现有 strict integer reader 离线生成 WAV；不经过 AudioPlayer/DSP。 */
export const extractUpnpCueWav = async (
  cuePath: string,
  trackNum: number,
): Promise<UpnpGeneratedInput> => {
  const filePath = path.join(generatedTempRoot(), `${crypto.randomUUID()}.wav`);
  try {
    const result = await getEngine().extractCueWav(cuePath, trackNum, filePath);
    return { filePath, durationMs: Math.max(0, result.durationMs) };
  } catch (error) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
};

/** DSD CUE 按原始 75fps bit 边界生成逻辑序列等价的 DSF。 */
export const extractUpnpCueDsf = async (
  cuePath: string,
  trackNum: number,
): Promise<UpnpGeneratedInput> => {
  const filePath = path.join(generatedTempRoot(), `${crypto.randomUUID()}.dsf`);
  try {
    const result = await getEngine().extractCueDsf(cuePath, trackNum, filePath);
    return { filePath, durationMs: Math.max(0, result.durationMs) };
  } catch (error) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
};

/** SACD 使用现有 stereo reader 离线生成 DSF；DST/DSD correctness 仍由 reader 自身负责。 */
export const extractUpnpSacdDsf = async (
  isoPath: string,
  trackNum: number,
): Promise<UpnpGeneratedInput> => {
  const filePath = path.join(generatedTempRoot(), `${crypto.randomUUID()}.dsf`);
  try {
    const result = await getEngine().extractSacdDsf(isoPath, trackNum, filePath);
    return { filePath, durationMs: Math.max(0, result.durationMs) };
  } catch (error) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
};

/** 删除尚未成功登记成媒体资源的 UPnP 临时输入或生成文件。 */
export const discardUpnpInput = async (filePath: string): Promise<void> => {
  const candidate = path.resolve(filePath);
  const roots = [inputTempRoot(), generatedTempRoot()].map((value) => path.resolve(value));
  if (!roots.some((root) => candidate.startsWith(`${root}${path.sep}`))) return;
  await fsp.rm(candidate, { force: true }).catch(() => {});
};

/** 释放媒体句柄；临时产物由创建者明确标记后才删除。 */
export const releaseMediaResource = async (resource: UpnpMediaResource | null): Promise<void> => {
  if (!resource) return;
  resources.delete(resource.id);
  if (resource.deleteOnRelease) await fsp.rm(resource.filePath, { force: true }).catch(() => {});
  await stopServerIfIdle();
};

/** 关闭 UPnP media listener 并释放当前资源。 */
export const shutdownUpnpMedia = async (): Promise<void> => {
  const active = [...resources.values()];
  resources.clear();
  await Promise.all(
    active.map((resource) =>
      resource.deleteOnRelease
        ? fsp.rm(resource.filePath, { force: true }).catch(() => {})
        : undefined,
    ),
  );
  if (server) {
    const current = server;
    server = null;
    port = 0;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
  await Promise.all([
    fsp.rm(inputTempRoot(), { recursive: true, force: true }).catch(() => {}),
    fsp.rm(generatedTempRoot(), { recursive: true, force: true }).catch(() => {}),
  ]);
};
