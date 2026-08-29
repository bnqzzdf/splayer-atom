import { coreApiOrigin } from "@/core/controlClient";

const HEADLESS_IMAGE_CACHE = /^\/cache\/(covers|artists|backgrounds)(?:\/|$)/;
const STREAMING_COVER_PATH = "/api/streaming/cover";

/** 识别由 Headless 图像缓存产生的 HTTP URL，并返回可复用路径。 */
const headlessCachePath = (value: string): string | null => {
  try {
    const url = new URL(value);
    const current = new URL(coreApiOrigin);
    if (!HEADLESS_IMAGE_CACHE.test(url.pathname)) return null;
    // 旧队列可能由 localhost 页面写入；同一 Headless 端口的缓存 URL 仍应映射到当前浏览器主机。
    if (url.port !== current.port && url.port !== "14558") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
};

/** 识别 Streaming 封面 URL，并返回当前 Core HTTP 路径。 */
const streamingCoverPath = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol === "streaming-cover:" && url.hostname === "image") {
      return `${STREAMING_COVER_PATH}${url.search}`;
    }
    if (url.pathname !== STREAMING_COVER_PATH) return null;
    const current = new URL(coreApiOrigin);
    if (url.port !== current.port && url.port !== "14558" && url.port !== "14559") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
};

/** 将 Electron cache:// / streaming-cover:// 或旧 Headless 图像 URL 映射到当前 Web Core origin。 */
export const webAssetUrl = (value: string | undefined): string | undefined => {
  if (!value) return value;
  if (value.startsWith("cache://")) {
    const rest = value.slice("cache://".length);
    return `${coreApiOrigin}/cache/${rest}`;
  }
  const streamingPath = streamingCoverPath(value);
  if (streamingPath) return `${coreApiOrigin}${streamingPath}`;
  const cachePath = headlessCachePath(value);
  return cachePath ? `${coreApiOrigin}${cachePath}` : value;
};

/** 当前 Control 的展示 URL；Desktop 保留 cache://，Web 投影为 HTTP。 */
export const controlAssetUrl = (value: string | undefined): string | undefined =>
  document.documentElement.dataset.atomRuntime === "web" ? webAssetUrl(value) : value;

/** 将 Web 展示 URL 还原为 Core 可持久化的资源 URL。 */
export const serverAssetUrl = (value: string | undefined): string | undefined => {
  if (!value || value.startsWith("cache://") || value.startsWith("streaming-cover://"))
    return value;
  const streamingPath = streamingCoverPath(value);
  if (streamingPath) {
    const query = streamingPath.slice(STREAMING_COVER_PATH.length);
    return `streaming-cover://image${query}`;
  }
  const cachePath = headlessCachePath(value);
  return cachePath ? `cache://${cachePath.slice("/cache/".length)}` : value;
};
