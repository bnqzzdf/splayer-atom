import { clearTidalAuth, getTidalAuthStatus, setTidalAuth } from "./auth";
import { TIDAL_API_BASE, TIDAL_DEFAULT_COUNTRY, TIDAL_USER_AGENT } from "./config";
import { materializeTidalDash } from "./dashMaterializer";
import { parseTidalPlaybackManifest, type TidalPlaybackInfo } from "./manifest";
import { tidalRequest } from "./request";

export type TidalParams = Record<string, unknown>;

interface TidalSessionResponse {
  userId?: string | number;
  countryCode?: string;
}

interface TidalSearchResponse {
  tracks?: {
    items?: unknown[];
    totalNumberOfItems?: number;
    limit?: number;
    offset?: number;
  };
  items?: unknown[];
  totalNumberOfItems?: number;
}

const validateAccessToken = async (accessToken: string): Promise<TidalSessionResponse> => {
  const response = await fetch(`${TIDAL_API_BASE}/sessions`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": TIDAL_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`TIDAL token 验证失败: HTTP ${response.status}`);
  return (await response.json()) as TidalSessionResponse;
};

const authImport = async (params: TidalParams): Promise<unknown> => {
  const accessToken = String(params.access_token ?? "").trim();
  if (!accessToken) throw new Error("缺少 TIDAL access_token");
  const session = await validateAccessToken(accessToken);
  const expiresAtParam = Number(params.expires_at);
  const expiresInParam = Number(params.expires_in);
  const expiresAt = Number.isFinite(expiresAtParam)
    ? expiresAtParam
    : Number.isFinite(expiresInParam)
      ? Date.now() + Math.max(expiresInParam, 60) * 1000
      : undefined;
  const userId = session.userId === undefined ? undefined : String(session.userId);
  const countryCode = session.countryCode || String(params.country_code ?? "").trim() || TIDAL_DEFAULT_COUNTRY;
  setTidalAuth({
    accessToken,
    refreshToken: String(params.refresh_token ?? "").trim() || undefined,
    expiresAt,
    userId,
    username: String(params.username ?? "").trim() || undefined,
    countryCode,
    clientId: String(params.client_id ?? process.env.TIDAL_CLIENT_ID ?? "").trim() || undefined,
  });
  return { loggedIn: true, userId, countryCode, refreshable: Boolean(params.refresh_token) };
};

const search = (params: TidalParams): Promise<TidalSearchResponse> => {
  const query = String(params.query ?? "").trim();
  if (!query) throw new Error("缺少 TIDAL 搜索关键词");
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  return tidalRequest<TidalSearchResponse>("/search", {
    query,
    type: String(params.type ?? "TRACKS").trim().toUpperCase(),
    limit,
    offset,
  });
};

const QUALITY_LADDERS: Record<string, readonly string[]> = {
  LOW: ["LOW", "HIGH"],
  HIGH: ["HIGH", "LOW"],
  LOSSLESS: ["LOSSLESS", "HIGH"],
  HI_RES: ["HI_RES_LOSSLESS", "LOSSLESS", "HIGH"],
  HI_RES_LOSSLESS: ["HI_RES_LOSSLESS", "LOSSLESS", "HIGH"],
};

const trackGetStreamUrl = async (params: TidalParams): Promise<unknown> => {
  const trackId = String(params.track_id ?? "").trim();
  if (!trackId) throw new Error("缺少 TIDAL track_id");
  const requestedQuality = String(params.quality ?? "LOSSLESS").trim().toUpperCase();
  const ladder = QUALITY_LADDERS[requestedQuality] ?? QUALITY_LADDERS.LOSSLESS;
  const tried: string[] = [];
  let lastPlaybackError = "";

  for (const quality of ladder) {
    if (tried.includes(quality)) continue;
    tried.push(quality);
    let info: TidalPlaybackInfo;
    try {
      info = await tidalRequest<TidalPlaybackInfo>(`/tracks/${trackId}/playbackinfopostpaywall`, {
        audioquality: quality,
        playbackmode: "STREAM",
        assetpresentation: "FULL",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastPlaybackError = message;
      if (/\((401|403|404)\)|HTTP\s+(401|403|404)/.test(message)) continue;
      throw err;
    }
    const parsed = parseTidalPlaybackManifest(info);
    if (!parsed) continue;
    if (parsed.kind === "url") {
      return {
        streamUrl: parsed.url,
        codec: parsed.codec,
        audioQuality: info.audioQuality || quality,
        bitDepth: info.bitDepth,
        sampleRate: info.sampleRate,
        requestedQuality,
        usedQuality: quality,
        triedQualities: tried,
      };
    }
    try {
      const materialized = await materializeTidalDash(parsed.xml, `${trackId}:${quality}`);
      return {
        localPath: materialized.path,
        codec: materialized.descriptor.codec || parsed.codec,
        audioQuality: info.audioQuality || quality,
        bitDepth: info.bitDepth,
        sampleRate: info.sampleRate || materialized.descriptor.sampleRate,
        requestedQuality,
        usedQuality: quality,
        triedQualities: tried,
        materialized: "dash-fmp4",
      };
    } catch (err) {
      lastPlaybackError = err instanceof Error ? err.message : String(err);
    }
  }

  const suffix = lastPlaybackError ? `; last=${lastPlaybackError}` : "";
  throw new Error(
    `无法获取 TIDAL 可播放音源: track=${trackId}, qualities=${tried.join(",")}${suffix}`,
  );
};

const handlers: Record<string, (params: TidalParams) => Promise<unknown> | unknown> = {
  auth_import: authImport,
  auth_status: () => getTidalAuthStatus(),
  auth_logout: () => {
    clearTidalAuth();
    return { loggedIn: false };
  },
  search,
  track_getStreamUrl: trackGetStreamUrl,
};

/**
 * 调用 TIDAL API 的最小统一入口。
 * @param name - TIDAL 动作名
 * @param params - 动作参数
 * @returns 动作结果
 */
export const callTidal = async (name: string, params: TidalParams = {}): Promise<unknown> => {
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  if (!handler) throw new Error(`unknown tidal api: ${name}`);
  return handler(params);
};
