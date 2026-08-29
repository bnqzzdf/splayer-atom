import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { Hono, type Context } from "hono";
import type { ApiPlatform } from "@shared/types/apis";
import type { PersonalFmOptions } from "@shared/types/personalFm";
import type {
  LoadOptions,
  PlaybackQueueItem,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { materializeDirectInput } from "@main/atom/directInput";
import { CORE_NODE_RANGE, CORE_NODE_REFERENCE } from "@main/atom/runtime/nodeRuntime";
import { loadPlayerSource } from "@main/services/playerLoad";
import {
  callProviderApi,
  clearProviderSession,
  setProviderCookie,
} from "@main/services/providerApi";
import * as nowPlaying from "@main/services/nowPlaying";
import { matchLocalTTML } from "@main/services/localLyricRepo";
import { store } from "@main/store";
import {
  appendQueue,
  clearQueue,
  getOutputDevices,
  getPlaybackSession,
  getSelectedOutputDevice,
  insertQueue,
  moveQueue,
  next,
  pause,
  play,
  playTrack,
  prev,
  removeQueueIndex,
  removeServerTracks,
  replaceQueue,
  refreshPlaybackPreload,
  reloadCurrent,
  scanDirettaDevices,
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
import { toDisplayDurationMs, toDisplayPositionMs } from "@main/services/playerTimeline";
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
import { toMs } from "@main/utils/time";
import { runtimeEnvironment } from "@main/atom/runtime/environment";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const commandError = (c: Context, error: unknown) => c.json({ error: errorText(error) }, 400);
const WEB_PROVIDER_PLATFORMS = new Set<ApiPlatform>(["netease", "qqmusic", "kugou"]);
const isWebProviderPlatform = (value: unknown): value is ApiPlatform =>
  typeof value === "string" && WEB_PROVIDER_PLATFORMS.has(value as ApiPlatform);
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

  api.get("/info", (c) =>
    c.json({
      name: runtimeEnvironment.appName,
      version: runtimeEnvironment.appVersion,
      platform: process.platform,
      node: process.versions.node,
      nodeRange: CORE_NODE_RANGE,
      nodeReference: CORE_NODE_REFERENCE,
    }),
  );

  api.get("/status", (c) => {
    const raw = getPlayer().getStatus();
    return c.json({
      state: raw.state,
      position: toDisplayPositionMs(toMs(raw.position)),
      duration: toDisplayDurationMs(toMs(raw.duration)),
      volume: raw.volume,
      speed: getPlayer().getSpeed(),
      isFinished: raw.isFinished,
    });
  });

  api.get("/config", (c) => c.json(store.store));
  api.post("/config", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      keyPath?: unknown;
      value?: unknown;
    } | null;
    if (typeof body?.keyPath !== "string" || !body.keyPath) {
      return c.json({ error: "keyPath_required" }, 400);
    }
    store.set(body.keyPath, body.value);
    if (
      body.keyPath === "player.songLevel" ||
      body.keyPath === "player.allowTrialPlay" ||
      body.keyPath === "player.preloadNextTrack"
    ) {
      refreshPlaybackPreload();
    }
    return c.json({ ok: true });
  });

  api.post("/providers/call", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: unknown;
      name?: unknown;
      params?: unknown;
    } | null;
    if (!isWebProviderPlatform(body?.platform)) {
      return c.json({ ok: false, error: "WEB_PROVIDER_UNSUPPORTED" }, 400);
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

  api.post("/providers/clear-session", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { platform?: unknown } | null;
    if (!isWebProviderPlatform(body?.platform)) {
      return c.json({ error: "WEB_PROVIDER_UNSUPPORTED" }, 400);
    }
    await clearProviderSession(body.platform);
    return c.json({ ok: true });
  });

  api.post("/providers/set-cookie", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: unknown;
      cookie?: unknown;
    } | null;
    if (!isWebProviderPlatform(body?.platform)) {
      return c.json({ ok: false, error: "WEB_PROVIDER_UNSUPPORTED" }, 400);
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
  api.post("/player/direct-input/materialize", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { source?: unknown } | null;
    if (typeof body?.source !== "string" || !body.source) {
      return c.json({ error: "source_required" }, 400);
    }
    try {
      return c.json({ path: await materializeDirectInput(body.source) });
    } catch (error) {
      return c.json({ error: errorText(error) }, 500);
    }
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
      track?: Track | null;
      lyric?: unknown[];
      source?: unknown;
    } | null;
    nowPlaying.update(
      body?.track ?? null,
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
  api.post("/lyrics/local", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { track?: Track } | null;
    if (!body?.track) return c.json({ ok: false, error: "track_required" }, 400);
    try {
      return c.json({ ok: true, data: await matchLocalTTML(body.track) });
    } catch (error) {
      return c.json({ ok: false, error: errorText(error) }, 500);
    }
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
    return c.json(await removeQueueIndex(index));
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
      const [diretta, local] = await Promise.all([
        scanDirettaDevices(),
        Promise.resolve(getOutputDevices()),
      ]);
      return c.json({ selected: getSelectedOutputDevice(), data: [...local, ...diretta] });
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
