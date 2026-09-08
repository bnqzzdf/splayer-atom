import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { Hono, type Context } from "hono";
import { isManagedProviderPlatform } from "@shared/types/apis";
import type { MusicCommentQuery } from "@shared/types/comment";
import type { PersonalFmOptions } from "@shared/types/personalFm";
import type { DownloadRequest } from "@shared/types/download";
import type { Platform } from "@shared/types/platform";
import type { StreamingServerInput } from "@shared/types/streaming";
import type {
  PluginInvokeMenuArgs,
  PluginMatchCoverArgs,
  PluginMatchLyricArgs,
  PluginResolveUrlArgs,
} from "@shared/types/plugin";
import type {
  LoadOptions,
  PlaybackQueueItem,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { playerControl } from "@main/services/playerControl";
import * as downloadManager from "@main/services/downloadManager";
import {
  clearCacheByKind,
  clearCacheCategory,
  getCacheDir,
  getCacheStats,
  resetCacheDir,
  switchCacheDir,
  type CacheCategory,
  type CacheKind,
} from "@main/services/cache";
import { getCoreInfo } from "@main/atom/runtime/coreInfo";
import { loadPlayerSource } from "@main/services/playerLoad";
import {
  callProviderApi,
  clearProviderSession,
  getProviderSessions,
  setProviderCookie,
} from "@main/services/providerApi";
import { getCommentSources, getMusicComments } from "@main/services/comments";
import * as nowPlaying from "@main/services/nowPlaying";
import { streamingControl } from "@main/services/streaming/control";
import {
  fetchLyricTTMLOverlay,
  matchCoreLocalTTML,
  matchLyricById,
  matchLyricByQuery,
} from "@main/services/lyricMatching";
import { store } from "@main/store";
import { getCoreSettingsSnapshot, setCoreSetting } from "@main/services/coreSettings";
import {
  clearListenBrainzOutbox,
  getListenBrainzStatus,
  linkListenBrainz,
  unlinkListenBrainz,
} from "@main/services/listenbrainz";
import {
  applyPluginUpdate,
  checkPluginUpdate,
  getPluginMarket,
  installPluginFromUrl,
  invokePluginMenu,
  listPlugins,
  matchPluginCover,
  matchPluginLyric,
  resolvePluginUrl,
  setPluginEnabled,
  setPluginSetting,
  uninstallPlugin,
} from "@main/services/pluginControl";
import {
  appendQueue,
  clearQueue,
  getOutputDevices,
  getPlaybackStatus,
  getPlaybackSession,
  getSelectedOutputDevice,
  insertQueue,
  moveQueue,
  migrateLegacyQueue,
  next,
  pause,
  play,
  playTrack,
  prev,
  removeQueueIndex,
  removeServerTracks,
  replaceQueue,
  reloadCurrent,
  scanDirettaDevices,
  scanUpnpOutputDevices,
  seek,
  selectIndex,
  setOutputDevice,
  setRepeat,
  setShuffle,
  setAutoClose,
  cancelAutoClose,
  startPersonalFm,
  dislikePersonalFm,
  stop,
  updateQueueItem,
  updateQueueTracks,
} from "@main/services/playbackSession";
import { getLibraryStats } from "@main/database";
import {
  getPlayHistoryDaily,
  getPlayHistoryHourly,
  getStatsSummary,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  insertFavoriteEvent,
} from "@main/database/playStats";
import type { FavoriteEventInput } from "@shared/types/stats";
import { testNetworkProxy } from "@main/utils/proxy";
import { getDownloadDir } from "@main/utils/config";
import { listCoreDirectories, resolveCoreDirectory } from "@main/services/coreFilesystem";
import { fetchProviderImage, parseProviderImageUrl } from "@main/services/providerImageProxy";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const commandError = (c: Context, error: unknown) => c.json({ error: errorText(error) }, 400);
const CACHE_CATEGORIES = new Set<CacheCategory>([
  "covers",
  "artists",
  "backgrounds",
  "songs",
  "lyric",
  "lyricTTML",
  "lyricMatch",
]);
const CACHE_KINDS = new Set<CacheKind>(["file", "db"]);
const DOWNLOAD_QUALITIES = new Set(["lq", "sq", "hq", "lossless", "hi-res"]);
const isDownloadRequest = (value: unknown): value is DownloadRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<DownloadRequest>;
  return (
    request.destination === "core" &&
    typeof request.taskId === "string" &&
    !!request.taskId &&
    !!request.track &&
    typeof request.track.id === "string" &&
    typeof request.track.source === "string" &&
    typeof request.qualityLevel === "string" &&
    DOWNLOAD_QUALITIES.has(request.qualityLevel) &&
    !!request.tagOptions &&
    typeof request.tagOptions === "object" &&
    typeof request.usePlaybackForDownload === "boolean" &&
    (request.lyricFileFormat === "lrc" || request.lyricFileFormat === "enhanced-lrc")
  );
};
const boundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
};

/**
 * Atom Headless 的 HTTP 控制面。
 * 只复用现有 main services / native player，不拥有第二份 player、queue 或 library 状态。
 */
export const buildHeadlessRoutes = (): Hono => {
  const api = new Hono();

  api.get("/info", (c) => c.json(getCoreInfo()));

  api.get("/proxy/image", async (c) => {
    const url = c.req.query("url");
    if (!parseProviderImageUrl(url))
      return c.json({ error: "unsupported provider image URL" }, 400);
    try {
      const asset = await fetchProviderImage(url!);
      return new Response(asset.bytes, {
        headers: {
          "Content-Type": asset.contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (error) {
      return c.json({ error: errorText(error) }, 502);
    }
  });

  api.get("/status", (c) => {
    return c.json(getPlaybackStatus());
  });

  api.get("/settings/core", (c) => c.json(getCoreSettingsSnapshot()));
  api.post("/settings/core", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      keyPath?: unknown;
      value?: unknown;
    } | null;
    if (typeof body?.keyPath !== "string" || !body.keyPath) {
      return c.json({ error: "keyPath_required" }, 400);
    }
    try {
      setCoreSetting(body.keyPath, body.value);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.get("/listenbrainz/status", (c) => c.json(getListenBrainzStatus()));
  api.put("/listenbrainz/link", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || !body.token.trim()) {
      return c.json({ error: "token_required" }, 400);
    }
    try {
      return c.json(await linkListenBrainz(body.token));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.delete("/listenbrainz/link", (c) => c.json(unlinkListenBrainz()));
  api.post("/listenbrainz/outbox/clear", (c) => {
    try {
      clearListenBrainzOutbox();
      return c.json(getListenBrainzStatus());
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.get("/plugins", (c) => c.json(listPlugins()));
  api.get("/plugins/market", async (c) => c.json(await getPluginMarket()));
  api.post("/plugins/install-url", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    if (typeof body?.url !== "string" || !body.url) {
      return c.json({ ok: false, error: "plugin_url_required" }, 400);
    }
    return c.json(await installPluginFromUrl(body.url));
  });
  api.post("/plugins/:id/uninstall", async (c) => c.json(await uninstallPlugin(c.req.param("id"))));
  api.post("/plugins/:id/enabled", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") return c.json({ error: "enabled_required" }, 400);
    try {
      await setPluginEnabled(c.req.param("id"), body.enabled);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/plugins/:id/setting", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      key?: unknown;
      value?: unknown;
    } | null;
    if (typeof body?.key !== "string" || !body.key) return c.json({ error: "key_required" }, 400);
    try {
      await setPluginSetting(c.req.param("id"), body.key, body.value);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/plugins/:id/check-update", async (c) =>
    c.json(await checkPluginUpdate(c.req.param("id"))),
  );
  api.post("/plugins/:id/apply-update", async (c) =>
    c.json(await applyPluginUpdate(c.req.param("id"))),
  );
  api.post("/plugins/resolve-url", async (c) => {
    const body = (await c.req.json().catch(() => null)) as PluginResolveUrlArgs | null;
    if (!body || typeof body.pluginId !== "string" || typeof body.source !== "string") {
      return c.json({ error: "plugin_resolve_args_invalid" }, 400);
    }
    try {
      return c.json(await resolvePluginUrl(body));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/plugins/invoke-menu", async (c) => {
    const body = (await c.req.json().catch(() => null)) as PluginInvokeMenuArgs | null;
    if (!body || typeof body.pluginId !== "string" || typeof body.menuId !== "string") {
      return c.json({ ok: false, error: "plugin_menu_args_invalid" }, 400);
    }
    return c.json(await invokePluginMenu(body));
  });
  api.post("/plugins/match-lyric", async (c) => {
    const body = (await c.req.json().catch(() => null)) as PluginMatchLyricArgs | null;
    if (!body || typeof body.pluginId !== "string" || typeof body.source !== "string") {
      return c.json({ ok: false, error: "plugin_lyric_args_invalid" }, 400);
    }
    try {
      return c.json(await matchPluginLyric(body));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/plugins/match-cover", async (c) => {
    const body = (await c.req.json().catch(() => null)) as PluginMatchCoverArgs | null;
    if (!body || typeof body.pluginId !== "string" || typeof body.source !== "string") {
      return c.json({ ok: false, error: "plugin_cover_args_invalid" }, 400);
    }
    try {
      return c.json(await matchPluginCover(body));
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.get("/cache/stats", async (c) => c.json(await getCacheStats()));
  api.get("/cache/dir", (c) => c.json({ dir: getCacheDir() }));
  api.post("/cache/dir", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dir?: unknown } | null;
    if (typeof body?.dir !== "string") return c.json({ error: "cache_dir_required" }, 400);
    try {
      const dir = await resolveCoreDirectory(body.dir);
      return c.json(await switchCacheDir(dir));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/cache/clear", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || !CACHE_CATEGORIES.has(body.id as CacheCategory)) {
      return c.json({ error: "cache_category_invalid" }, 400);
    }
    await clearCacheCategory(body.id as CacheCategory);
    return c.json({ ok: true });
  });
  api.post("/cache/clear-all", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { kind?: unknown } | null;
    if (typeof body?.kind !== "string" || !CACHE_KINDS.has(body.kind as CacheKind)) {
      return c.json({ error: "cache_kind_invalid" }, 400);
    }
    await clearCacheByKind(body.kind as CacheKind);
    return c.json({ ok: true });
  });
  api.post("/cache/reset-dir", async (c) => c.json({ dir: await resetCacheDir() }));

  api.get("/filesystem/directories", async (c) => {
    try {
      return c.json(await listCoreDirectories(c.req.query("path")));
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.get("/download/tasks", (c) => c.json(downloadManager.list()));
  api.get("/download/dir", (c) => c.json({ dir: getDownloadDir() }));
  api.post("/download/dir", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dir?: unknown } | null;
    if (typeof body?.dir !== "string") return c.json({ error: "dir_required" }, 400);
    try {
      const dir = await resolveCoreDirectory(body.dir);
      store.set("download.dir", dir);
      return c.json({ dir });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/download/reset-dir", (c) => {
    store.set("download.dir", null);
    return c.json({ dir: getDownloadDir() });
  });
  api.post("/download/start", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isDownloadRequest(body)) return c.json({ error: "download_request_invalid" }, 400);
    return c.json(downloadManager.enqueue(body));
  });
  api.post("/download/start-many", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body) || !body.every(isDownloadRequest)) {
      return c.json({ error: "download_requests_invalid" }, 400);
    }
    return c.json(downloadManager.enqueueMany(body));
  });
  api.post("/download/cancel", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { taskId?: unknown } | null;
    if (typeof body?.taskId !== "string") return c.json({ error: "task_id_required" }, 400);
    downloadManager.cancel(body.taskId);
    return c.json({ ok: true });
  });
  api.post("/download/remove", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { taskId?: unknown } | null;
    if (typeof body?.taskId !== "string") return c.json({ error: "task_id_required" }, 400);
    downloadManager.remove(body.taskId);
    return c.json({ ok: true });
  });
  api.post("/download/clear-finished", (c) => {
    downloadManager.clearFinished();
    return c.json({ ok: true });
  });

  api.post("/system/network-proxy/test", async (c) => c.json({ ok: await testNetworkProxy() }));

  api.post("/providers/call", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: unknown;
      name?: unknown;
      params?: unknown;
    } | null;
    if (!isManagedProviderPlatform(body?.platform)) {
      return c.json({ ok: false, error: "PROVIDER_UNSUPPORTED" }, 400);
    }
    if (typeof body?.name !== "string" || !body.name) {
      return c.json({ ok: false, error: "provider_name_required" }, 400);
    }
    const params =
      body.params && typeof body.params === "object" && !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : {};
    return c.json(await callProviderApi(body.platform, body.name, params));
  });

  api.get("/providers/sessions", (c) => c.json(getProviderSessions()));

  api.post("/providers/clear-session", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { platform?: unknown } | null;
    if (!isManagedProviderPlatform(body?.platform)) {
      return c.json({ error: "PROVIDER_UNSUPPORTED" }, 400);
    }
    await clearProviderSession(body.platform);
    return c.json({ ok: true });
  });

  api.get("/comments/sources", (c) => c.json(getCommentSources()));
  api.post("/comments/music", async (c) => {
    const body = (await c.req.json().catch(() => null)) as MusicCommentQuery | null;
    if (
      !body ||
      typeof body.sourceId !== "string" ||
      !body.track ||
      typeof body.track.id !== "string" ||
      (body.type !== "hot" && body.type !== "new")
    ) {
      return c.json({ ok: false, error: "comment_query_invalid" }, 400);
    }
    try {
      return c.json({ ok: true, data: await getMusicComments(body) });
    } catch (error) {
      return c.json({ ok: false, error: errorText(error) });
    }
  });

  api.post("/providers/set-cookie", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: unknown;
      cookie?: unknown;
    } | null;
    if (!isManagedProviderPlatform(body?.platform)) {
      return c.json({ ok: false, error: "PROVIDER_UNSUPPORTED" }, 400);
    }
    if (typeof body.cookie !== "string")
      return c.json({ ok: false, error: "cookie_required" }, 400);
    return c.json(setProviderCookie(body.platform, body.cookie));
  });

  api.get("/stats/summary", (c) => c.json(getStatsSummary()));
  api.get("/stats/library", (c) => c.json(getLibraryStats()));
  api.get("/stats/top-tracks", (c) =>
    c.json(getTopTracks(boundedInt(c.req.query("limit"), 10, 1, 100))),
  );
  api.get("/stats/daily", (c) =>
    c.json(getPlayHistoryDaily(boundedInt(c.req.query("days"), 30, 1, 365))),
  );
  api.get("/stats/hourly", (c) => c.json(getPlayHistoryHourly()));
  api.get("/stats/top-albums", (c) =>
    c.json(getTopAlbums(boundedInt(c.req.query("limit"), 10, 1, 100))),
  );
  api.get("/stats/top-artists", (c) =>
    c.json(getTopArtists(boundedInt(c.req.query("limit"), 10, 1, 100))),
  );
  api.post("/stats/favorite", async (c) => {
    const body = (await c.req.json().catch(() => null)) as FavoriteEventInput | null;
    if (!body?.track?.id || (body.action !== "add" && body.action !== "remove")) {
      return c.json({ error: "invalid_favorite_event" }, 400);
    }
    insertFavoriteEvent(body);
    return c.json({ ok: true });
  });

  api.post("/player/load", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      source?: unknown;
      options?: LoadOptions;
    } | null;
    if (typeof body?.source !== "string" || !body.source) {
      return c.json({ success: false, error: "source_required" }, 400);
    }
    return c.json(await loadPlayerSource(body.source, body.options ?? {}));
  });
  api.get("/volume", (c) => c.json({ volume: getPlayer().getVolume() }));
  api.post("/volume", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { volume?: number } | null;
    const volume = Number(body?.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      return c.json({ error: "volume (number, 0..1) required" }, 400);
    }
    try {
      getPlayer().setVolume(volume);
      store.set("player.volume", volume);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/reinit", async (c) => {
    try {
      await playerControl.reinitOutput();
      return c.json({ success: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/speed", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { speed?: number } | null;
    const speed = Number(body?.speed);
    if (!Number.isFinite(speed)) return c.json({ error: "speed_required" }, 400);
    try {
      getPlayer().setSpeed(speed);
      nowPlaying.onSpeedChange(speed);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/pitch", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { semitones?: number } | null;
    try {
      getPlayer().setPitch(Number(body?.semitones ?? 0));
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/pitch-sync", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { enabled?: boolean } | null;
    try {
      getPlayer().setPitchSync(body?.enabled === true);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/normalization", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { enabled?: boolean } | null;
    try {
      getPlayer().setNormalizationEnabled(body?.enabled === true);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/equalizer", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      enabled?: boolean;
      bands?: number[];
      preamp?: number;
    } | null;
    try {
      if (Array.isArray(body?.bands)) getPlayer().setEqualizerBands(body.bands);
      if (typeof body?.preamp === "number") getPlayer().setPreampGain(body.preamp);
      if (typeof body?.enabled === "boolean") getPlayer().setEqualizerEnabled(body.enabled);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.post("/player/fade", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { durationMs?: number } | null;
    try {
      getPlayer().setFadeDuration(Math.max(0, Number(body?.durationMs ?? 0)));
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.get("/player/fade", (c) => c.json({ data: getPlayer().getFadeDuration() }));

  api.post("/player/fft", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { enabled?: boolean } | null;
    try {
      getPlayer().setFftEnabled(body?.enabled === true);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.get("/player/fft", (c) => c.json({ data: getPlayer().getFftData() }));

  api.get("/player/cover", (c) => {
    try {
      const raw = getPlayer().getCoverRaw();
      return c.json({
        data: raw ? `data:image/jpeg;base64,${Buffer.from(raw).toString("base64")}` : null,
      });
    } catch (error) {
      return c.json({ error: errorText(error) }, 500);
    }
  });

  api.post("/player/read-lyric", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    if (typeof body?.path !== "string") return c.json({ error: "path_required" }, 400);
    const allowed = new Set([".ttml", ".lys", ".qrc", ".krc", ".yrc", ".lrc", ".ass", ".srt"]);
    if (!allowed.has(extname(body.path).toLowerCase()))
      return c.json({ error: "unsupported_lyric" }, 400);
    try {
      return c.json({ data: await readFile(body.path, "utf-8") });
    } catch (error) {
      return c.json({ error: errorText(error) }, 500);
    }
  });

  api.get("/now-playing", (c) => c.json(nowPlaying.lightSnapshot()));
  api.get("/lyrics", (c) => c.json(nowPlaying.lyricSnapshot()));
  api.post("/now-playing", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      lyric?: unknown[];
      source?: unknown;
    } | null;
    nowPlaying.updateLyrics(
      Array.isArray(body?.lyric) ? (body.lyric as never[]) : [],
      (body?.source ?? null) as never,
    );
    return c.json({ ok: true });
  });
  api.post("/now-playing/lyric-offset", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      trackId?: unknown;
      offsetMs?: unknown;
    } | null;
    if (typeof body?.trackId !== "string") return c.json({ error: "trackId_required" }, 400);
    nowPlaying.setLyricOffset(body.trackId, Number(body.offsetMs ?? 0));
    return c.json({ ok: true });
  });
  api.post("/lyrics/match-by-id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: Platform;
      id?: unknown;
    } | null;
    if (!body?.platform || typeof body.id !== "string") {
      return c.json({ ok: false, error: "platform_and_id_required" }, 400);
    }
    return c.json(await matchLyricById(body.platform, body.id));
  });
  api.post("/lyrics/match-by-query", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: Platform;
      track?: Track;
    } | null;
    if (!body?.platform || !body.track) {
      return c.json({ ok: false, error: "platform_and_track_required" }, 400);
    }
    return c.json(await matchLyricByQuery(body.platform, body.track));
  });
  api.post("/lyrics/ttml-overlay", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: "netease" | "qqmusic";
      track?: Track;
    } | null;
    if (!body?.track || (body.platform !== "netease" && body.platform !== "qqmusic")) {
      return c.json({ ok: false, error: "track_and_supported_platform_required" }, 400);
    }
    return c.json(await fetchLyricTTMLOverlay(body.track, body.platform));
  });
  api.post("/lyrics/local", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { track?: Track } | null;
    if (!body?.track) return c.json({ ok: false, error: "track_required" }, 400);
    return c.json(await matchCoreLocalTTML(body.track));
  });

  api.get("/streaming/config", (c) => c.json(streamingControl.loadServers()));
  api.post("/streaming/server", async (c) => {
    const input = (await c.req.json().catch(() => null)) as StreamingServerInput | null;
    if (!input) return c.json({ error: "server_input_required" }, 400);
    try {
      return c.json(streamingControl.addServer(input));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.patch("/streaming/server/:serverId", async (c) => {
    const input = (await c.req.json().catch(() => null)) as StreamingServerInput | null;
    if (!input) return c.json({ error: "server_input_required" }, 400);
    try {
      return c.json(streamingControl.updateServer(c.req.param("serverId"), input));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.delete("/streaming/server/:serverId", (c) => {
    try {
      streamingControl.removeServer(c.req.param("serverId"));
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/streaming/active", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { serverId?: string | null } | null;
    try {
      streamingControl.setActiveServer(body?.serverId ?? null);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/streaming/test", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      input?: StreamingServerInput;
      serverId?: string;
    } | null;
    if (!body?.input) return c.json({ error: "server_input_required" }, 400);
    return c.json(await streamingControl.testConnection(body.input, body.serverId));
  });
  api.post("/streaming/connect", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { serverId?: string } | null;
    if (!body?.serverId) return c.json({ error: "server_id_required" }, 400);
    return c.json(await streamingControl.connect(body.serverId));
  });
  api.post("/streaming/disconnect", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { serverId?: string } | null;
    if (!body?.serverId) return c.json({ error: "server_id_required" }, 400);
    streamingControl.disconnect(body.serverId);
    return c.json({ ok: true });
  });
  api.get("/streaming/snapshot", (c) => {
    const serverId = c.req.query("serverId");
    if (!serverId) return c.json({ error: "server_id_required" }, 400);
    try {
      return c.json(streamingControl.getSnapshot(serverId));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/streaming/sync", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      serverId?: string;
      force?: boolean;
    } | null;
    if (!body?.serverId) return c.json({ error: "server_id_required" }, 400);
    try {
      return c.json({ started: streamingControl.sync(body.serverId, body.force === true) });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.get("/streaming/search", (c) => {
    const serverId = c.req.query("serverId");
    if (!serverId) return c.json({ error: "server_id_required" }, 400);
    return c.json(streamingControl.search(serverId, c.req.query("query") ?? ""));
  });
  api.get("/streaming/album-songs", async (c) => {
    const serverId = c.req.query("serverId");
    const albumId = c.req.query("albumId");
    if (!serverId || !albumId) return c.json({ error: "server_and_album_required" }, 400);
    return c.json(await streamingControl.getAlbumSongs(serverId, albumId));
  });
  api.get("/streaming/playlist-songs", async (c) => {
    const serverId = c.req.query("serverId");
    const playlistId = c.req.query("playlistId");
    if (!serverId || !playlistId) return c.json({ error: "server_and_playlist_required" }, 400);
    return c.json(await streamingControl.getPlaylistSongs(serverId, playlistId));
  });
  api.get("/streaming/artist-albums", async (c) => {
    const serverId = c.req.query("serverId");
    const artistId = c.req.query("artistId");
    if (!serverId || !artistId) return c.json({ error: "server_and_artist_required" }, 400);
    return c.json(await streamingControl.getArtistAlbums(serverId, artistId));
  });
  api.get("/streaming/artist-songs", async (c) => {
    const serverId = c.req.query("serverId");
    const artistId = c.req.query("artistId");
    if (!serverId || !artistId) return c.json({ error: "server_and_artist_required" }, 400);
    return c.json(await streamingControl.getArtistSongs(serverId, artistId));
  });
  api.post("/streaming/lyrics", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      serverId?: string;
      trackId?: string;
      hint?: { artist?: string; title?: string };
    } | null;
    if (!body?.serverId || !body.trackId) {
      return c.json({ error: "server_and_track_required" }, 400);
    }
    return c.json({
      lyric: await streamingControl.getLyrics(body.serverId, body.trackId, body.hint),
    });
  });
  api.get("/streaming/cover", async (c) => {
    const serverId = c.req.query("serverId");
    const coverId = c.req.query("coverId");
    if (!serverId || !coverId) return c.body(null, 400);
    const bytes = await streamingControl.getCover(
      serverId,
      coverId,
      Number(c.req.query("size")) || 300,
    );
    if (!bytes) return c.body(null, 204);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": "application/octet-stream",
      },
    });
  });

  api.post("/play", async (c) => {
    try {
      await play();
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/pause", (c) => {
    pause();
    return c.json({ ok: true });
  });
  api.post("/stop", (c) => {
    stop();
    return c.json({ ok: true });
  });
  api.post("/seek", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { positionMs?: number } | null;
    const positionMs = Number(body?.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0)
      return c.json({ error: "positionMs required" }, 400);
    try {
      await seek(positionMs);
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/next", async (c) => {
    try {
      await next();
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/prev", async (c) => {
    try {
      await prev();
      return c.json({ ok: true });
    } catch (error) {
      return commandError(c, error);
    }
  });

  api.get("/session", (c) => c.json(getPlaybackSession()));
  api.post("/session/migrate-legacy", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      items?: PlaybackQueueItem[];
      originalItems?: PlaybackQueueItem[] | null;
      index?: number;
      repeat?: RepeatMode;
      shuffle?: ShuffleMode;
    } | null;
    const index = Number(body?.index);
    if (
      !Array.isArray(body?.items) ||
      !Number.isInteger(index) ||
      (body?.originalItems !== null && !Array.isArray(body?.originalItems)) ||
      (body?.repeat !== "list" && body?.repeat !== "one") ||
      (body?.shuffle !== "off" && body?.shuffle !== "on")
    ) {
      return c.json({ error: "valid legacy queue snapshot required" }, 400);
    }
    return c.json(
      migrateLegacyQueue(body.items, body.originalItems ?? null, index, body.repeat, body.shuffle),
    );
  });
  api.post("/session/reload", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { forcePlay?: boolean } | null;
    return c.json({ reloaded: await reloadCurrent(body?.forcePlay) });
  });
  api.post("/session/queue", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      items?: PlaybackQueueItem[];
      startIndex?: number;
      autoPlay?: boolean;
      loadCurrent?: boolean;
    } | null;
    if (!Array.isArray(body?.items)) return c.json({ error: "items array required" }, 400);
    try {
      return c.json(
        await replaceQueue(
          body.items,
          Number(body.startIndex ?? 0) || 0,
          body.autoPlay !== false,
          body.loadCurrent !== false,
        ),
      );
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/session/play-track", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      track?: Track;
      autoPlay?: boolean;
    } | null;
    if (!body?.track) return c.json({ error: "track required" }, 400);
    try {
      return c.json(await playTrack(body.track, body.autoPlay !== false));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/session/queue/append", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { items?: PlaybackQueueItem[] } | null;
    if (!Array.isArray(body?.items)) return c.json({ error: "items array required" }, 400);
    return c.json(appendQueue(body.items));
  });
  api.post("/session/queue/insert", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      items?: PlaybackQueueItem[];
      index?: number;
    } | null;
    const index = Number(body?.index);
    if (!Array.isArray(body?.items) || !Number.isInteger(index)) {
      return c.json({ error: "items array and integer index required" }, 400);
    }
    return c.json(insertQueue(body.items, index));
  });
  api.post("/session/queue/move", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      fromIndex?: number;
      toIndex?: number;
    } | null;
    const fromIndex = Number(body?.fromIndex);
    const toIndex = Number(body?.toIndex);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return c.json({ error: "integer fromIndex and toIndex required" }, 400);
    }
    return c.json(moveQueue(fromIndex, toIndex));
  });
  api.patch("/session/queue/:index", async (c) => {
    const index = Number(c.req.param("index"));
    const body = (await c.req.json().catch(() => null)) as { item?: PlaybackQueueItem } | null;
    if (!Number.isInteger(index) || !body?.item)
      return c.json({ error: "valid index and item required" }, 400);
    return c.json(updateQueueItem(index, body.item));
  });
  api.patch("/session/queue/tracks", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { tracks?: Track[] } | null;
    if (!Array.isArray(body?.tracks)) return c.json({ error: "tracks array required" }, 400);
    return c.json(updateQueueTracks(body.tracks));
  });
  api.delete("/session/server/:serverId", (c) =>
    c.json(removeServerTracks(c.req.param("serverId"))),
  );
  api.post("/session/queue/select", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      index?: number;
      autoPlay?: boolean;
      loadCurrent?: boolean;
    } | null;
    const index = Number(body?.index);
    if (!Number.isInteger(index)) return c.json({ error: "integer index required" }, 400);
    try {
      return c.json(
        await selectIndex(index, body?.loadCurrent !== false, body?.autoPlay !== false),
      );
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.delete("/session/queue/:index", async (c) => {
    const index = Number(c.req.param("index"));
    if (!Number.isInteger(index)) return c.json({ error: "valid queue index required" }, 400);
    const loadCurrent = c.req.query("loadCurrent") !== "0";
    return c.json(await removeQueueIndex(index, loadCurrent));
  });
  api.delete("/session/queue", async (c) => {
    await clearQueue(true);
    return c.json(getPlaybackSession());
  });
  api.post("/session/queue/clear", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { stop?: boolean } | null;
    await clearQueue(body?.stop === true);
    return c.json(getPlaybackSession());
  });
  api.post("/session/next", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { loadCurrent?: boolean } | null;
    await next(body?.loadCurrent !== false);
    return c.json(getPlaybackSession());
  });
  api.post("/session/prev", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { loadCurrent?: boolean } | null;
    await prev(body?.loadCurrent !== false);
    return c.json(getPlaybackSession());
  });
  api.post("/session/repeat", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { mode?: RepeatMode } | null;
    if (body?.mode !== "list" && body?.mode !== "one")
      return c.json({ error: "mode must be list or one" }, 400);
    return c.json(setRepeat(body.mode));
  });
  api.post("/session/shuffle", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { mode?: ShuffleMode } | null;
    if (body?.mode !== "off" && body?.mode !== "on")
      return c.json({ error: "mode must be off or on" }, 400);
    return c.json(setShuffle(body.mode));
  });
  api.post("/session/personal-fm", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      options?: PersonalFmOptions;
      autoPlay?: boolean;
    } | null;
    try {
      return c.json(await startPersonalFm(body?.options, body?.autoPlay !== false));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/session/personal-fm/dislike", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { playedSec?: number } | null;
    try {
      return c.json(await dislikePersonalFm(body?.playedSec));
    } catch (error) {
      return commandError(c, error);
    }
  });
  api.post("/session/auto-close", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      durationMin?: number;
      waitSongEnd?: boolean;
    } | null;
    const durationMin = Number(body?.durationMin);
    if (!Number.isFinite(durationMin)) return c.json({ error: "durationMin required" }, 400);
    return c.json(setAutoClose(durationMin, body?.waitSongEnd === true));
  });
  api.delete("/session/auto-close", (c) => c.json(cancelAutoClose()));

  api.get("/output/devices", async (c) => {
    try {
      const [diretta, upnp, local] = await Promise.all([
        scanDirettaDevices(),
        scanUpnpOutputDevices(),
        Promise.resolve(getOutputDevices()),
      ]);
      return c.json({ selected: getSelectedOutputDevice(), data: [...local, ...diretta, ...upnp] });
    } catch (error) {
      return c.json({ error: errorText(error) }, 500);
    }
  });
  api.post("/output/select", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { deviceId?: string | null } | null;
    if (body == null || !("deviceId" in body)) return c.json({ error: "deviceId required" }, 400);
    try {
      await setOutputDevice(body.deviceId ?? null);
      return c.json({ ok: true, selected: body.deviceId ?? null });
    } catch (error) {
      return c.json({ error: errorText(error) }, 500);
    }
  });

  return api;
};
