import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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
): Promise<void> => {
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
    const input = Readable.fromWeb(response.body as never);
    await pipeline(input, fs.createWriteStream(partPath));
    const stat = await fsp.stat(partPath);
    if (stat.size === 0) throw new Error("Exact input 下载结果为空");
    await fsp.rm(filePath, { force: true });
    await fsp.rename(partPath, filePath);
  } catch (error) {
    await fsp.rm(partPath, { force: true }).catch(() => {});
    throw error;
  }
};
