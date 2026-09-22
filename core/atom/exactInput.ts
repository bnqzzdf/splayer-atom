import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ExactInputFormat =
  | "flac"
  | "ogg"
  | "wav"
  | "aiff"
  | "mp4"
  | "mp3"
  | "dsf"
  | "dff"
  | "ape"
  | "matroska"
  | "wavpack"
  | "unknown";

export interface ExactInputResult {
  format: ExactInputFormat;
}

/** 根据音频容器的 magic 判断格式；未知格式仍交给后续 FFmpeg 探测。 */
export const sniffAudioFormat = (bytes: Uint8Array): ExactInputFormat => {
  const has = (offset: number, value: string): boolean =>
    Buffer.from(value, "ascii").every((byte, index) => bytes[offset + index] === byte);
  if (has(0, "fLaC")) return "flac";
  if (has(0, "OggS")) return "ogg";
  if (has(0, "RIFF") && has(8, "WAVE")) return "wav";
  if (has(0, "FORM") && (has(8, "AIFF") || has(8, "AIFC"))) return "aiff";
  if (has(4, "ftyp")) return "mp4";
  if (has(0, "ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return "mp3";
  if (has(0, "DSD ")) return "dsf";
  if (has(0, "FRM8") && has(12, "DSD ")) return "dff";
  if (has(0, "MAC ")) return "ape";
  if (has(0, "\x1a\x45\xdf\xa3")) return "matroska";
  if (has(0, "wvpk")) return "wavpack";
  return "unknown";
};

const assertHttpSource = (source: string): URL => {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Exact input 仅接受 HTTP(S) 音源");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Exact input 仅接受 HTTP(S) 音源");
  }
  return url;
};

/**
 * 把 HTTP 响应 payload 原样写入指定文件，并通过 `.part` 原子发布。
 * 调用方拥有目标路径、复用、取消和清理生命周期。
 * @param source - 已解析出的 HTTP(S) 音频 URL
 * @param filePath - 最终本地文件路径
 * @param signal - 可选取消信号
 */
export const writeExactHttpInput = async (
  source: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<ExactInputResult> => {
  assertHttpSource(source);
  const response = await fetch(source, {
    headers: { "Accept-Encoding": "identity" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Exact input 下载失败: HTTP ${response.status}`);
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const partPath = `${filePath}.part`;
  try {
    const reader = response.body.getReader();
    let prefix = Buffer.alloc(0);
    let format: ExactInputFormat = "unknown";
    let prefixYielded = false;
    const input = Readable.from(
      (async function* () {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          if (prefix.length < 64) {
            const combined = Buffer.concat([prefix, chunk]);
            prefix = combined.subarray(0, 64);
            format = sniffAudioFormat(prefix);
            if (prefix.length < 64) continue;
            yield combined;
            prefixYielded = true;
          } else {
            yield chunk;
          }
        }
        if (!prefixYielded && prefix.length > 0) {
          format = sniffAudioFormat(prefix);
          yield prefix;
        }
      })(),
    );
    await pipeline(input, fs.createWriteStream(partPath));
    const stat = await fsp.stat(partPath);
    if (stat.size === 0) throw new Error("Exact input 下载结果为空");
    await fsp.rm(filePath, { force: true });
    await fsp.rename(partPath, filePath);
    return { format };
  } catch (error) {
    await fsp.rm(partPath, { force: true }).catch(() => {});
    throw error;
  }
};
