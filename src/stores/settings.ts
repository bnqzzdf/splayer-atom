import type {
  PlayerSettings,
  LyricSettings,
  AppearanceSettings,
  SidebarNavGroup,
  SidebarPlaylistOrder,
  SpringPreset,
  PresetSettings,
} from "@/types/settings";
import {
  DEFAULT_LYRIC_FORMAT_ORDER,
  DEFAULT_LYRIC_SOURCE_ORDER,
  SUPPORTED_LYRIC_PLATFORMS,
  DEFAULT_SIDEBAR_NAV_GROUPS,
  SIDEBAR_GROUP_MY_PLAYLISTS,
  SIDEBAR_GROUP_SUBSCRIBED,
  SPRING_PRESETS,
} from "@/types/settings";
import { isCoreSettingPath, type SystemConfig, type LocaleCode } from "@shared/types/settings";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { setByPath } from "@shared/utils/path";
import { settingsClient } from "@/core/settingsClient";

const WEB_CONTROL_CONFIG_KEY = "splayer/web-control-system";
const WEB_CONTROL_SETTING_PATHS = new Set(["system.onboardingCompleted", "system.uiZoom"]);

/** 读取当前浏览器 Control 自己持有的轻量配置。 */
const loadWebControlEntries = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(WEB_CONTROL_CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/** 应用只影响当前浏览器 Control 的展示配置。 */
const applyWebControlEntry = (keyPath: string, value: unknown): void => {
  if (keyPath !== "system.uiZoom" || typeof value !== "number" || !Number.isFinite(value)) return;
  const percent = Math.max(50, Math.min(200, value));
  document.documentElement.style.setProperty("zoom", `${percent}%`);
};

/** 持久化当前浏览器 Control 自己持有的配置。 */
const saveWebControlEntry = (keyPath: string, value: unknown): void => {
  if (!WEB_CONTROL_SETTING_PATHS.has(keyPath)) {
    throw new Error(`Setting is not owned by Web Control: ${keyPath}`);
  }
  const entries = loadWebControlEntries();
  entries[keyPath] = value;
  localStorage.setItem(WEB_CONTROL_CONFIG_KEY, JSON.stringify(entries));
  applyWebControlEntry(keyPath, value);
};

/**
 * 对账有序集合：保留存档中仍有效的项（顺序不变），
 * 末尾补上完整集合里缺失的新项，剔除已失效的项
 * 用于平台/格式偏好——新增平台或格式时无需用户手动重置即可生效
 * @param stored - 存档顺序
 * @param all - 当前完整集合
 * @returns 对账后的顺序
 */
const reconcileOrder = <T>(stored: T[], all: readonly T[]): T[] => {
  const known = stored.filter((item) => all.includes(item));
  const missing = all.filter((item) => !known.includes(item));
  return [...known, ...missing];
};

/**
 * 对账侧边栏导航分组：仅保留已知导航项并去重（空组保留），
 * 新增的导航项补到末组，存档无效时回退默认分组
 * @param stored - 存档分组
 * @returns 对账后的分组
 */
const reconcileNavGroups = (stored: unknown): SidebarNavGroup[] => {
  const all = DEFAULT_SIDEBAR_NAV_GROUPS.flatMap((group) => group.keys);
  const seen = new Set<string>();
  const groups: SidebarNavGroup[] = [];
  for (const raw of Array.isArray(stored) ? stored : []) {
    const record = raw as Partial<SidebarNavGroup> | null;
    if (!Array.isArray(record?.keys)) continue;
    const keys: string[] = [];
    for (const key of record.keys) {
      if (!all.includes(key) || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    groups.push({
      name: typeof record.name === "string" ? record.name : "",
      showName: record.showName === true,
      keys,
    });
  }
  if (groups.length === 0)
    return DEFAULT_SIDEBAR_NAV_GROUPS.map((group) => ({ ...group, keys: [...group.keys] }));
  const missing = all.filter((key) => !seen.has(key));
  if (missing.length > 0) groups[groups.length - 1].keys.push(...missing);
  return groups;
};

/**
 * 对账侧边栏隐藏键：仅保留有效的导航项、歌单分组与歌单路由键，首页不可隐藏
 * @param stored - 存档隐藏键
 * @returns 对账后的隐藏键
 */
const reconcileHiddenKeys = (stored: string[]): string[] => {
  const valid = new Set([
    ...DEFAULT_SIDEBAR_NAV_GROUPS.flatMap((group) => group.keys),
    SIDEBAR_GROUP_MY_PLAYLISTS,
    SIDEBAR_GROUP_SUBSCRIBED,
  ]);
  return stored.filter((key) => key !== "/" && (valid.has(key) || key.startsWith("/collection/")));
};

/**
 * 对账侧边栏歌单顺序：剔除非法存档，保证各字段均为字符串数组
 * @param stored - 存档顺序
 * @returns 对账后的顺序
 */
const reconcilePlaylistOrder = (stored: unknown): SidebarPlaylistOrder => {
  const record = (stored ?? {}) as Partial<Record<keyof SidebarPlaylistOrder, unknown>>;
  const orderOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
  return {
    myLocal: orderOf(record.myLocal),
    myOnline: orderOf(record.myOnline),
    subscribed: orderOf(record.subscribed),
  };
};

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 界面语言 */
    const locale = ref<LocaleCode>("zh-CN");

    /** 外观 */
    const appearance = reactive<AppearanceSettings>({
      layoutMode: "default",
      routeTransition: "fade",
      sidebarCollapsed: false,
      sidebarPlaylistCover: false,
      sidebarNavGroups: DEFAULT_SIDEBAR_NAV_GROUPS.map((group) => ({
        ...group,
        keys: [...group.keys],
      })),
      sidebarHiddenKeys: [],
      sidebarKeepEmptyDivider: false,
      sidebarNameWithDivider: false,
      sidebarPlaylistOrder: { myLocal: [], myOnline: [], subscribed: [] },
      showStatsInSidebar: true,
      showQualitySwitch: false,
      closeAction: "hide",
      rememberCloseChoice: false,
      fontFamily: "",
      showPerformanceMonitor: false,
    });

    /** 播放器 */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      playerBgFps: 30,
      playerBgFlowSpeed: 4,
      playerBgRenderScale: 0.5,
      playerBgFreezeOnPause: false,
      playerBgBeat: false,
      coverLayout: "default",
      coverLyricRatio: 0.45,
      autoCenterCover: true,
      showPlaybackSource: false,
      followCoverColor: true,
      autoImmersive: true,
      outputDevice: null,
      enableSpectrum: false,
      spectrumBarWidth: 4,
      reverseSpectrum: false,
      timeFormat: "current-total",
      showProgressTooltip: true,
      showProgressLyric: false,
      snapToLyric: false,
      showLyricInBar: true,
    });

    /** 强迫症设置 */
    const preset = reactive<PresetSettings>({
      uncensorProfanity: false,
      hideVipTag: false,
      hideQualityTag: false,
      showSubtitle: true,
    });

    /** 歌词 */
    const lyric = reactive<LyricSettings>({
      lyricSourcePreference: "auto",
      lyricSourceOrder: [...DEFAULT_LYRIC_SOURCE_ORDER],
      lyricFormatOrder: [...DEFAULT_LYRIC_FORMAT_ORDER],
      smartPreferOnline: false,
      preferPluginLyric: false,
      detectBackgroundLyrics: true,
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      lyricBlendMode: "normal",
      fontFamily: "",
      fontFamilyLatin: "",
      fontFamilyJapanese: "",
      fontFamilyKorean: "",
      fontFamilyChinese: "",
      showTranslation: true,
      showRomanization: true,
      amllShowLineRomanization: true,
      amllShowWordRomanization: true,
      enableWordHighlight: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
      enableBlur: false,
      hidePassedLines: false,
      springPreset: "default",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
      alignPosition: 0.35,
      wordFadeWidth: 0.5,
      inactiveAlpha: 0.2,
      enableExcludeLyrics: true,
      excludeLyricsUserKeywords: [],
      excludeLyricsUserRegexes: [],
      engine: "physics",
      useAMSpring: true,
      amllVerticalSpringMass: 1,
      amllVerticalSpringDamping: 15,
      amllVerticalSpringStiffness: 100,
      amllVerticalSpringSoft: false,
      amllScaleSpringMass: 1,
      amllScaleSpringDamping: 20,
      amllScaleSpringStiffness: 100,
      amllScaleSpringSoft: false,
      amllCleanUnintentionalOverlaps: true,
      amllTryAdvanceStartTime: true,
      amllConvertExcessiveBackgroundLines: true,
      amllSyncMainAndBackgroundLines: true,
      amllNormalizeSpaces: true,
      amllResetLineTimestamps: true,
    });

    /** 系统配置 - 传递主进程 */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /**
     * 深合并：嵌套对象原地 mutate，叶子值不变就不写
     * 避免浅 Object.assign 替换嵌套引用，导致依赖路径的 watcher 误触
     */
    const deepAssign = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
      for (const key of Object.keys(source)) {
        const next = source[key];
        const cur = target[key];
        if (
          next &&
          typeof next === "object" &&
          !Array.isArray(next) &&
          cur &&
          typeof cur === "object" &&
          !Array.isArray(cur)
        ) {
          deepAssign(cur as Record<string, unknown>, next as Record<string, unknown>);
        } else if (cur !== next) {
          target[key] = next;
        }
      }
    };

    /** 同步 This Control 配置与 Core Settings；Core snapshot 最后覆盖 Core-owned domain。 */
    const syncSystem = async (): Promise<void> => {
      try {
        for (const [keyPath, value] of Object.entries(loadWebControlEntries())) {
          if (!WEB_CONTROL_SETTING_PATHS.has(keyPath)) continue;
          setByPath(system, keyPath, value);
          applyWebControlEntry(keyPath, value);
        }
        const coreSettings = await settingsClient.getSnapshot();
        deepAssign(
          system as unknown as Record<string, unknown>,
          coreSettings as unknown as Record<string, unknown>,
        );
      } catch {}
    };

    /**
     * 写入后端配置并同步本地
     * 先就地 mutate 叶子保证 UI 即时反馈，IPC 落盘异步执行
     */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      setByPath(system, keyPath, value);
      try {
        if (isCoreSettingPath(keyPath)) {
          await settingsClient.set(keyPath, value);
        } else {
          saveWebControlEntry(keyPath, value);
        }
      } catch (err) {
        console.error("[settings] setting write failed", keyPath, err);
      }
    };

    /** 本地配置写入后处理 */
    const afterLocalChange = (path: string, value: unknown): void => {
      if (path === "lyric.springPreset" && value !== "custom") {
        const params = SPRING_PRESETS[value as Exclude<SpringPreset, "custom">];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      }
    };

    return {
      locale,
      appearance,
      player,
      preset,
      lyric,
      system,
      syncSystem,
      setSystem,
      afterLocalChange,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
      afterHydrate: ({ store }) => {
        const { lyric, appearance } = store as unknown as {
          lyric: LyricSettings;
          appearance: AppearanceSettings;
        };
        if (typeof lyric.detectBackgroundLyrics !== "boolean") {
          lyric.detectBackgroundLyrics = true;
        }
        lyric.lyricSourceOrder = reconcileOrder(lyric.lyricSourceOrder, SUPPORTED_LYRIC_PLATFORMS);
        if (lyric.lyricSourcePreference === "qobuz" || lyric.lyricSourcePreference === "tidal") {
          lyric.lyricSourcePreference = "auto";
        }
        lyric.lyricFormatOrder = reconcileOrder(lyric.lyricFormatOrder, DEFAULT_LYRIC_FORMAT_ORDER);
        appearance.sidebarNavGroups = reconcileNavGroups(appearance.sidebarNavGroups ?? []);
        appearance.sidebarHiddenKeys = reconcileHiddenKeys(appearance.sidebarHiddenKeys ?? []);
        appearance.sidebarPlaylistOrder = reconcilePlaylistOrder(appearance.sidebarPlaylistOrder);
      },
    },
  },
);
