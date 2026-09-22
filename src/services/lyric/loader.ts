/**
 * 当前歌曲歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { bestExternalIndex } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@/types/settings";
import {
  embeddedLyricFromDetail,
  isBetterFormat,
  isPluginLyricPreferred,
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolveStreamingByPreference,
  resolveTTMLOverlay,
  type LocalLyric,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyric/resolve";
import { consumePreloadedLyric } from "@/services/lyric/preload";
import { playerClient } from "@/core/playerClient";

/** 竞态 token */
let currentToken = 0;

/** 当前加载周期是否已经接受过在线、插件或 TTML 竞争候选 */
let competitiveCommitToken = 0;

type CandidateMode = "provisional" | "competitive" | "preference";

/** 只有用户明确选择的平台候选允许替换上一轮更高格式歌词 */
const onlineCandidateMode = (source: NonNullable<LyricData>): CandidateMode => {
  const preference = useSettingsStore().lyric.lyricSourcePreference;
  if (preference === "auto" || preference === "self") return "competitive";
  return source.source === "online" && source.platform === preference
    ? "preference"
    : "competitive";
};

/** 比较歌词请求与当前播放歌曲的稳定身份 */
const isCurrentTrack = (token: number, track: Track): boolean => {
  if (token !== currentToken) return false;
  const current = useMediaStore().track;
  if (!current || current.source !== track.source || current.id !== track.id) return false;
  if (track.source !== "streaming") return true;
  return (current.serverId ?? "") === (track.serverId ?? "");
};

/**
 * 读取本地歌词
 * @param detail - 歌曲详细信息
 */
const readLocal = async (
  detail: TrackDetail,
): Promise<{ source: NonNullable<LyricData>; content: string } | null> => {
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const idx = bestExternalIndex(detail.externalLyrics, order);
  if (idx !== -1) {
    const ext = detail.externalLyrics[idx];
    const result = await playerClient.readLyricFile(ext.path);
    if (!result.success || result.data == null) return null;
    return { source: { source: "external", format: ext.format }, content: result.data };
  }
  return embeddedLyricFromDetail(detail);
};

/**
 * 通过统一有效性、质量和竞态门提交歌词候选
 * @param token - 竞态 token
 * @param track - 候选所属歌曲
 * @param resolved - 歌词候选
 * @param mode - 候选竞争模式
 */
const commitCandidate = (
  token: number,
  track: Track,
  resolved: ResolvedLyric,
  mode: CandidateMode,
): boolean => {
  if (!isCurrentTrack(token, track)) return false;
  const media = useMediaStore();
  const currentFormat = media.activeLyric?.format ?? null;
  const mayFollowPreference = mode === "preference" && competitiveCommitToken !== token;
  if (currentFormat && !isBetterFormat(resolved.source.format, currentFormat)) {
    if (!mayFollowPreference) return false;
  }
  const accepted = media.setLyric(resolved.source, resolved.input);
  if (accepted && mode !== "provisional") competitiveCommitToken = token;
  return accepted;
};

/** 提交本地歌词候选 */
const commitLocal = (
  token: number,
  track: Track,
  local: LocalLyric,
  mode: CandidateMode = "provisional",
): boolean =>
  commitCandidate(token, track, { source: local.source, input: { content: local.content } }, mode);

/** 当前没有有效歌词时结束加载状态 */
const finishWithoutLyric = (token: number, track: Track): void => {
  if (!isCurrentTrack(token, track)) return;
  const media = useMediaStore();
  if (media.parsedLyric.length === 0) media.setLyric(null, null);
};

/** 插件优选并发期间由统一包装器负责最终结束加载 */
const finishNormalSources = (token: number, track: Track): void => {
  if (!isPluginLyricPreferred()) finishWithoutLyric(token, track);
};

/** 在线候选在后台尝试 TTML 升级 */
const scheduleTTMLUpgrade = (token: number, track: Track, online: OnlineResult): void => {
  void resolveTTMLOverlay(track, online)
    .then((ttml) => {
      if (ttml) commitCandidate(token, track, ttml, "competitive");
    })
    .catch((err) => console.warn("[lyricLoader] TTML 歌词升级失败:", err));
};

/** 已解析在线候选在后台尝试 TTML 升级 */
const scheduleResolvedTTMLUpgrade = (
  token: number,
  track: Track,
  resolved: ResolvedLyric,
): void => {
  if (
    resolved.source.source !== "online" ||
    !resolved.source.platform ||
    resolved.source.format === "ttml"
  ) {
    return;
  }
  scheduleTTMLUpgrade(token, track, {
    source: {
      source: "online",
      format: resolved.source.format,
      platform: resolved.source.platform,
    },
    input: resolved.input,
  });
};

/**
 * 提交在线基础歌词并启动 TTML 后台升级
 */
const applyOnline = (
  token: number,
  track: Track,
  online: OnlineResult,
  fallbackLocal: LocalLyric | null,
): void => {
  const mode = onlineCandidateMode(online.source);
  const accepted = commitCandidate(
    token,
    track,
    { source: online.source, input: online.input },
    mode,
  );
  if (!accepted && useMediaStore().parsedLyric.length === 0 && fallbackLocal) {
    commitLocal(token, track, fallbackLocal, mode);
  }
  scheduleTTMLUpgrade(token, track, online);
  if (useMediaStore().parsedLyric.length === 0) finishNormalSources(token, track);
};

/**
 * 本地 TTML 歌词库匹配：命中即以最高优先级提交，调用方据此跳过在线请求
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否命中
 */
const tryLocalRepo = async (token: number, track: Track): Promise<boolean> => {
  const resolved = await resolveLocalRepoLyric(track);
  if (!isCurrentTrack(token, track)) return false;
  return resolved ? commitCandidate(token, track, resolved, "preference") : false;
};

/**
 * 插件兜底匹配歌词：内置平台都没歌词时，向声明 musicLyric 的插件源逐个兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否已提交有效歌词
 */
const tryPluginFallback = async (token: number, track: Track): Promise<boolean> => {
  // 插件优选时不处理
  if (isPluginLyricPreferred()) return false;
  const resolved = await resolvePluginLyric(track);
  if (!isCurrentTrack(token, track)) return false;
  return resolved ? commitCandidate(token, track, resolved, "competitive") : false;
};

/**
 * 插件优先加载
 * 插件请求与正常流程并发，任一候选返回后立即进入统一质量门
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param run - 正常加载流程
 */
const withPluginPrefer = async (
  token: number,
  track: Track,
  run: () => Promise<void>,
): Promise<void> => {
  if (!isPluginLyricPreferred()) {
    await run();
    return;
  }
  const pluginTask = resolvePluginLyric(track)
    .then((plugin) => {
      if (plugin) commitCandidate(token, track, plugin, "competitive");
    })
    .catch((err) => console.warn("[lyricLoader] 插件歌词加载失败:", err));
  let runError: unknown;
  try {
    await run();
  } catch (err) {
    runError = err;
  }
  await pluginTask;
  if (runError) throw runError;
  finishWithoutLyric(token, track);
};

/**
 * 流媒体歌词加载：按来源偏好解析，失败后使用插件和内嵌歌词兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param detail - 歌曲详细信息
 */
const loadStreamingLyric = (
  token: number,
  track: Track,
  detail: TrackDetail | null,
): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const resolved = await resolveStreamingByPreference(track, () => token === currentToken);
    if (!isCurrentTrack(token, track)) return;
    const embeddedFallback = embeddedLyricFromDetail(detail);
    if (resolved) {
      const accepted = commitCandidate(
        token,
        track,
        resolved,
        onlineCandidateMode(resolved.source),
      );
      scheduleResolvedTTMLUpgrade(token, track, resolved);
      if (accepted) return;
    }
    if (!isCurrentTrack(token, track)) return;
    if (await tryPluginFallback(token, track)) return;
    if (embeddedFallback) {
      commitLocal(token, track, embeddedFallback);
    } else {
      finishNormalSources(token, track);
    }
  });

/**
 * 在线平台歌曲歌词加载
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const loadPlatformLyric = (token: number, track: Track): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const online = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
      shouldContinue: () => token === currentToken,
    });
    if (!isCurrentTrack(token, track)) return;
    if (online) {
      applyOnline(token, track, online, null);
    } else if (!(await tryPluginFallback(token, track))) {
      finishNormalSources(token, track);
    }
  });

/** 开启新一轮加载周期 */
export const beginLoad = (): number => {
  currentToken++;
  useMediaStore().resetLyricState();
  return currentToken;
};

/**
 * 为当前 track 加载歌词
 *
 * 1. 无 track：commit null 收尾
 * 2. 在线歌曲：
 *    - 默认顺序下，track.platform 与候选平台一致时走 matchById
 *    - 不一致则走 matchByQuery
 * 3. 本地歌曲：本地有先立即 commit 显示；再按偏好查在线，命中热替换
 * 4. 本地 + 在线都无：commit null 收尾 loading
 *
 * @param detail - 歌曲详细信息
 */
export const loadForTrack = async (detail: TrackDetail | null): Promise<void> => {
  const token = beginLoad();
  let requestedTrack: Track | null = null;
  try {
    const media = useMediaStore();
    const track = media.track;
    requestedTrack = track;
    // 无 track
    if (!track) {
      if (token === currentToken) media.setLyric(null, null);
      return;
    }
    const preloaded = await consumePreloadedLyric(track);
    if (!isCurrentTrack(token, track)) return;
    if (preloaded.hit) {
      const accepted = commitCandidate(token, track, preloaded.lyric, "competitive");
      scheduleResolvedTTMLUpgrade(token, track, preloaded.lyric);
      if (accepted) return;
    }
    // 本地 TTML 歌词库最高优先
    if (await tryLocalRepo(token, track)) return;
    if (!isCurrentTrack(token, track)) return;
    // 在线歌曲（任一在线平台）
    if (isPlatform(track.source)) {
      await loadPlatformLyric(token, track);
      return;
    }
    // 流媒体服务器
    if (track.source === "streaming") {
      await loadStreamingLyric(token, track, detail);
      return;
    }
    // 本地文件
    const local = detail ? await readLocal(detail) : null;
    if (!isCurrentTrack(token, track)) return;
    // 本地立即显示
    if (local) commitLocal(token, track, local);
    // 本地文件存在但解析后空
    const hasUsableLocal = !!local && media.parsedLyric.length > 0;
    const localFormat = local?.source.format ?? null;

    await withPluginPrefer(token, track, async () => {
      // 按偏好获取歌词
      const online = await resolveOnlineByPreference(track, {
        hasLocal: hasUsableLocal,
        localFormat,
        onCandidate: (result) =>
          commitCandidate(
            token,
            track,
            { source: result.source, input: result.input },
            "competitive",
          ),
        shouldContinue: () => token === currentToken,
      });
      if (!isCurrentTrack(token, track)) return;
      // id 回查本地 TTML 库
      if (online && (await tryLocalRepo(token, track))) return;
      if (online) {
        applyOnline(token, track, online, local);
      } else if (!hasUsableLocal && !(await tryPluginFallback(token, track))) {
        finishNormalSources(token, track);
      }
    });
  } catch (err) {
    console.error("[lyricLoader] loadForTrack failed:", err);
    if (requestedTrack) finishWithoutLyric(token, requestedTrack);
  }
};

/** 偏好变化时的刷新 */
const refreshPreference = async (): Promise<void> => {
  currentToken++;
  const token = currentToken;
  const media = useMediaStore();
  const track = media.track;
  if (!track) return;
  // 本地 TTML 歌词库最高优先
  if (await tryLocalRepo(token, track)) return;
  if (!isCurrentTrack(token, track)) return;
  if (track.source === "streaming") {
    await loadStreamingLyric(token, track, media.detail);
    return;
  }
  // 在线歌曲（任一在线平台）
  if (isPlatform(track.source)) {
    await loadPlatformLyric(token, track);
    return;
  }
  // 本地歌曲
  const detail = media.detail;
  const local = detail ? await readLocal(detail) : null;
  if (!isCurrentTrack(token, track)) return;
  const localFormat = local?.source.format ?? null;
  const showingOnline = media.activeLyric?.source === "online";

  await withPluginPrefer(token, track, async () => {
    /** 按偏好获取歌词 */
    const online = await resolveOnlineByPreference(track, {
      hasLocal: !!local,
      localFormat,
      onCandidate: (result) =>
        commitCandidate(
          token,
          track,
          { source: result.source, input: result.input },
          "competitive",
        ),
      shouldContinue: () => token === currentToken,
    });
    if (!isCurrentTrack(token, track)) return;
    if (online) {
      applyOnline(token, track, online, local);
      return;
    }
    // 目标是本地
    if (!showingOnline) return;
    if (local) commitLocal(token, track, local, "preference");
    else finishNormalSources(token, track);
  });
};

/** 监听歌词偏好变化 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.lyric.lyricSourcePreference,
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
      settings.lyric.detectBackgroundLyrics,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
    ],
    () => {
      refreshPreference();
    },
  );
};
