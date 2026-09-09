import { fetchWithProxy } from "@main/utils/proxy";

const PROVIDER_IMAGE_HOSTS = new Set(["resources.tidal.com", "static.qobuz.com"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 仅允许代理已知音乐服务的公开 HTTPS 图片 CDN，避免把 Control 路由变成通用 SSRF 代理。 */
export const parseProviderImageUrl = (value: string | undefined): URL | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !PROVIDER_IMAGE_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

export interface ProviderImageAsset {
  bytes: ArrayBuffer;
  contentType: string;
}

/**
 * 通过 Core 网络栈读取 provider 封面，并限制类型、重定向和响应大小。
 * @param value - TIDAL/Qobuz 图片 URL
 * @returns 可直接返回给 Control 的图片内容
 */
export const fetchProviderImage = async (value: string): Promise<ProviderImageAsset> => {
  const url = parseProviderImageUrl(value);
  if (!url) throw new Error("unsupported provider image URL");

  const response = await fetchWithProxy(url, {
    headers: { Accept: "image/*" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`provider image HTTP ${response.status}`);

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!contentType.startsWith("image/"))
    throw new Error("provider image returned non-image content");

  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_IMAGE_BYTES) {
    throw new Error("provider image exceeds size limit");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("provider image exceeds size limit");
  return { bytes, contentType };
};
