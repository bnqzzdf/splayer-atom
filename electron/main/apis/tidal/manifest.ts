export interface TidalPlaybackInfo {
  url?: string;
  streamUrl?: string;
  manifest?: string;
  manifestMimeType?: string;
  audioQuality?: string;
  bitDepth?: number;
  sampleRate?: number;
}

export type TidalParsedManifest =
  | {
      kind: "url";
      url: string;
      mimeType?: string;
      codec?: string;
    }
  | {
      kind: "dash";
      xml: string;
      mimeType: "application/dash+xml";
      codec?: string;
    };

const decodeBase64Utf8 = (value: string): string | null => {
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return null;
  }
};

const parseJsonUrl = (value: string): TidalParsedManifest | null => {
  try {
    const parsed = JSON.parse(value) as {
      urls?: unknown;
      mimeType?: unknown;
      codecs?: unknown;
    };
    const urls = Array.isArray(parsed.urls) ? parsed.urls : [];
    const url = urls.find((item): item is string => typeof item === "string" && item.length > 0);
    if (!url) return null;
    return {
      kind: "url",
      url,
      mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : undefined,
      codec: typeof parsed.codecs === "string" ? parsed.codecs : undefined,
    };
  } catch {
    return null;
  }
};

const dashCodec = (xml: string): string | undefined =>
  xml.match(/<Representation[^>]*\scodecs="([^"]+)"/)?.[1];

/**
 * 解析 TIDAL playback info 中的直链或 DASH manifest。
 * DASH 只识别并返回原始 XML；是否支持播放由上层显式决定。
 * @param info - TIDAL playback info
 * @returns 可播放 URL / DASH 描述；无法识别时返回 null
 */
export const parseTidalPlaybackManifest = (
  info: TidalPlaybackInfo | null | undefined,
): TidalParsedManifest | null => {
  if (!info) return null;
  if (info.url) return { kind: "url", url: info.url };
  if (info.streamUrl) return { kind: "url", url: info.streamUrl };
  if (!info.manifest) return null;

  const mimeType = info.manifestMimeType?.toLowerCase() ?? "";
  const decoded = decodeBase64Utf8(info.manifest);

  if (mimeType.includes("dash+xml")) {
    const xml = decoded ?? info.manifest;
    if (!xml.includes("<MPD")) return null;
    return {
      kind: "dash",
      xml,
      mimeType: "application/dash+xml",
      codec: dashCodec(xml),
    };
  }

  if (decoded) {
    const json = parseJsonUrl(decoded);
    if (json) return json;
  }

  const rawJson = parseJsonUrl(info.manifest);
  if (rawJson) return rawJson;

  return null;
};
