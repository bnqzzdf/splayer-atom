import crypto from "node:crypto";
import { rmSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { runtimeEnvironment } from "@main/atom/runtime/environment";
import { TIDAL_USER_AGENT } from "./config";
import { parseTidalDashManifest, type TidalDashDescriptor } from "./dash";

const SEGMENT_TIMEOUT_MS = 120_000;
const inFlight = new Map<string, Promise<TidalDashMaterialization>>();
let cleanupRegistered = false;

export interface TidalDashMaterialization {
  path: string;
  descriptor: TidalDashDescriptor;
}

const tempRoot = (): string =>
  path.join(runtimeEnvironment.tempDir, "splayer-atom-tidal-dash", String(process.pid));

const registerCleanup = (): void => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("exit", () => {
    rmSync(tempRoot(), { recursive: true, force: true });
  });
};

const materializedPath = (key: string): string => {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 20);
  return path.join(tempRoot(), `${hash}.mp4`);
};

const isReusable = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() && stat.size > 8;
  } catch {
    return false;
  }
};

const fetchSegment = async (url: string): Promise<Buffer> => {
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "Accept-Encoding": "identity",
      "User-Agent": TIDAL_USER_AGENT,
    },
    signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TIDAL DASH 分段下载失败: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("TIDAL DASH 分段为空");
  return buffer;
};

const verifyMp4Header = async (filePath: string): Promise<void> => {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 8) throw new Error("TIDAL DASH materialization 输出过短");
    const boxType = buffer.subarray(4, 8).toString("ascii");
    if (boxType !== "ftyp" && boxType !== "styp") {
      throw new Error(`TIDAL DASH materialization 不是 MP4/ISOBMFF: ${boxType}`);
    }
  } finally {
    await handle.close();
  }
};

const materialize = async (xml: string, key: string): Promise<TidalDashMaterialization> => {
  const descriptor = parseTidalDashManifest(xml);
  const finalPath = materializedPath(key);
  if (await isReusable(finalPath)) return { path: finalPath, descriptor };

  registerCleanup();
  await fsp.mkdir(tempRoot(), { recursive: true });
  const partPath = `${finalPath}.part`;
  const handle = await fsp.open(partPath, "w");
  try {
    for (const url of [descriptor.initializationUrl, ...descriptor.mediaUrls]) {
      const segment = await fetchSegment(url);
      await handle.write(segment);
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(partPath, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();

  try {
    await verifyMp4Header(partPath);
    await fsp.rm(finalPath, { force: true });
    await fsp.rename(partPath, finalPath);
    return { path: finalPath, descriptor };
  } catch (error) {
    await fsp.rm(partPath, { force: true }).catch(() => {});
    throw error;
  }
};

/**
 * 把 TIDAL DASH initialization + media fragments 顺序拼成进程级临时 fMP4。
 * 不依赖系统 ffmpeg，不创建第二套持久歌曲缓存。
 * @param xml - TIDAL MPD XML
 * @param key - 本次曲目/音质的稳定键
 * @returns 可直接交给 SPlayer 现有 MOV/MP4 demuxer 的本地路径
 */
export const materializeTidalDash = (
  xml: string,
  key: string,
): Promise<TidalDashMaterialization> => {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = materialize(xml, key).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
};
