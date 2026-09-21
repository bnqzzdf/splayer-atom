import type { PluginsConfig, PluginQuality } from "./plugin";
import type { DownloadLyricFormat, DownloadFolderScheme } from "./download";

/** 支持的语言代码 */
export type LocaleCode = "zh-CN" | "en-US";

/** 语言选项 */
export const LOCALES: { value: LocaleCode; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

/** 均衡器预设标识 */
export type EqualizerPreset =
  | "flat"
  | "custom"
  | "pop"
  | "rock"
  | "classical"
  | "electronic"
  | "bass"
  | "vocal"
  | "dance"
  | "soft";

/** 均衡器配置 */
export interface EqualizerSettings {
  /** 是否启用均衡器 */
  enabled: boolean;
  /** 当前选中的预设 */
  preset: EqualizerPreset;
  /** 10 频段增益（dB），范围 [-15, 15]，对应 31/62/125/250/500/1k/2k/4k/8k/16k Hz */
  bands: number[];
  /** 前级增益（dB），范围 [-12, 12] */
  preamp: number;
}

/** ALSA 本地输出的显式播放模式。 */
export type AlsaPlaybackMode = "direct" | "processed";

/** 播放器配置 */
export interface PlayerSettings {
  /** 加载后自动播放 */
  autoPlay: boolean;
  /** 记忆上次播放的歌曲 */
  rememberLastTrack: boolean;
  /** 是否启用渐入渐出 */
  fadeEnabled: boolean;
  /** 渐入渐出时长（毫秒） */
  fadeDuration: number;
  /** 输出设备名称，null 为系统默认 */
  outputDevice: string | null;
  /** ALSA 本地输出模式；Diretta/UPnP 不读取此偏好。 */
  alsaPlaybackMode: AlsaPlaybackMode;
  /** 默认音量（0.0 ~ 1.0） */
  volume: number;
  /** 在线歌曲音质偏好；影响 Core 实际音源解析 */
  songLevel: PluginQuality;
  /** 完整音源不可用时是否允许 Core 使用试听片段 */
  allowTrialPlay: boolean;
  /** Core 是否提前解析下一首播放输入 */
  preloadNextTrack: boolean;
  /** 输出设备发生切换/重建前是否先暂停播放 */
  pauseOnDeviceSwitch: boolean;
  /** 是否跳过带 DJ/车载/热歌等关键词的曲目 */
  fuckDjMode: boolean;
  /** 音量均衡（响度归一化） */
  loudnessNormalization: boolean;
  /** Processed PCM 最终削波保护；Direct 不读取。 */
  clippingProtection: boolean;
  /** 均衡器配置 */
  equalizer: EqualizerSettings;
  /** 按 `{Track.id}|{歌词源}` 记忆的歌词偏移（ms，正值为歌词提前）；为 0 时不写入 */
  lyricOffsets: Record<string, number>;
}

/** ListenBrainz 集成配置 */
export interface ListenBrainzSettings {
  /** 总开关 */
  enabled: boolean;
  /** 是否发送正在播放 */
  sendNowPlaying: boolean;
}

/** 音乐库配置 */
export interface LibrarySettings {
  /** 扫描目录列表 */
  scanDirs: string[];
}

/** 流媒体总开关 */
export interface StreamingSettings {
  /** 启用流媒体；关闭后侧边栏隐藏入口 */
  enabled: boolean;
}

/** 网络代理协议 */
export type NetworkProxyProtocol = "off" | "http" | "https" | "socks5";

/** 网络代理配置 */
export interface NetworkProxySettings {
  /** 代理协议；off 时不改变原始请求路径 */
  protocol: NetworkProxyProtocol;
  /** 代理服务器地址 */
  host: string;
  /** 代理服务器端口 */
  port: number;
}

/** 在线歌词服务配置 */
export interface OnlineLyricSettings {
  /** 启用在线 TTML 歌词 */
  enableOnlineTTMLLyric: boolean;
  /** AMLL TTML DB 服务地址，需含 %s 占位符 */
  amllDbServer: string;
}

/** 本地歌词配置 */
export interface LocalLyricSettings {
  /** 启用本地 TTML 歌词库：从指定目录按元信息匹配 .ttml，命中优先于在线源 */
  enableLocalTTMLOverride: boolean;
  /** 本地 TTML 歌词库目录 */
  repoDir: string;
}

/** 歌曲缓存配置 */
export interface SongCacheSettings {
  /** 歌曲缓存总开关 */
  enabled: boolean;
  /** 是否缓存个人流媒体服务器歌曲 */
  cacheStreaming: boolean;
  /** 上限（GB），0 表示不限制；超限按 LRU 淘汰 */
  sizeLimitGb: number;
}

/** 缓存配置 */
export interface CacheSettings {
  /** 自定义缓存目录；null 使用默认 {userData}/app-data/cache */
  dir: string | null;
  /** 歌曲文件级缓存 */
  songCache: SongCacheSettings;
}

/** 下载配置 */
export interface DownloadSettings {
  /** 下载功能总开关；关闭后隐藏应用内所有下载入口，下载设置仍可预先配置 */
  enabled: boolean;
  /** 下载目录；null 使用系统下载目录下的应用子目录 */
  dir: string | null;
  /** 下载音质 */
  quality: PluginQuality;
  /** 模拟播放下载：网易云用播放接口替代下载接口，避免占用每日下载次数 */
  usePlaybackForDownload: boolean;
  /** 文件名模板，支持 {artist} {title} {album}；不含子目录 */
  fileTemplate: string;
  /** 文件智能分类：按规则分子文件夹 */
  folderScheme: DownloadFolderScheme;
  /** 重名处理策略 */
  overwritePolicy: "rename" | "overwrite" | "skip";
  /** 内嵌封面 */
  embedCover: boolean;
  /** 内嵌标题/艺术家/专辑等元信息 */
  embedMeta: boolean;
  /** 内嵌歌词到标签 */
  embedLyric: boolean;
  /** 额外保存同名歌词文件 */
  writeLrc: boolean;
  /** 额外保存完整 TTML */
  saveTtml: boolean;
  /** 保存 / 内嵌的歌词格式 */
  lyricFileFormat: DownloadLyricFormat;
}

/** NCM 听歌打卡上报方式 */
export type NeteaseScrobbleMode = "legacy" | "ncbl";

/** KG 登录版本 */
export type KugouLoginVersion = "standard" | "concept";

/** 后端配置汇总 */
export interface SystemConfig {
  /** 播放器配置 */
  player: PlayerSettings;
  /** 音乐库配置 */
  library: LibrarySettings;
  /** 在线歌词服务配置 */
  lyric: OnlineLyricSettings;
  /** 本地歌词配置 */
  localLyric: LocalLyricSettings;
  /** 缓存配置 */
  cache: CacheSettings;
  /** 下载配置 */
  download: DownloadSettings;
  /** 流媒体总开关 */
  streaming: StreamingSettings;
  /** ListenBrainz 集成配置 */
  listenbrainz: ListenBrainzSettings;
  /** 系统配置 */
  system: {
    /** 界面缩放百分比（50-200，默认 100） */
    uiZoom: number;
    /** 首启引导是否已完成 */
    onboardingCompleted: boolean;
    /** NCM请求注入国内 IP（X-Real-IP/X-Forwarded-For） */
    neteaseRealIp: boolean;
    /** KG 登录版本（standard 标准版 / concept 概念版） */
    kugouLoginVersion: KugouLoginVersion;
    /** 网络代理配置 */
    networkProxy: NetworkProxySettings;
    /** 听歌打卡开关 */
    neteaseScrobbleEnabled: boolean;
    /** 听歌打卡上报方式 */
    neteaseScrobbleMode: NeteaseScrobbleMode;
  };
  /** 插件系统配置 */
  plugins: PluginsConfig;
}

/** Core Settings 读取快照；Host / Control-local / Plugin 专属配置不在这里投影。 */
export interface CoreSettingsSnapshot {
  player: PlayerSettings;
  library: LibrarySettings;
  lyric: OnlineLyricSettings;
  localLyric: LocalLyricSettings;
  cache: CacheSettings;
  download: DownloadSettings;
  streaming: StreamingSettings;
  listenbrainz: ListenBrainzSettings;
  system: Pick<
    SystemConfig["system"],
    "neteaseRealIp" | "networkProxy" | "neteaseScrobbleEnabled" | "neteaseScrobbleMode"
  >;
}

/** Core Domain 持有的全部配置前缀；其中部分 mutation 由专用 domain client 负责。 */
const CORE_OWNED_SETTING_PREFIXES = [
  "player.",
  "library.",
  "lyric.",
  "localLyric.",
  "cache.",
  "download.",
  "streaming.",
  "listenbrainz.",
  "system.networkProxy.",
] as const;

/** 由 Core Domain 持有、允许通过共享 Core Settings Protocol 修改的配置路径。 */
const CORE_SETTING_PREFIXES = [
  "player.",
  "lyric.",
  "localLyric.",
  "cache.songCache.",
  "download.",
  "listenbrainz.",
  "system.networkProxy.",
] as const;

const CORE_SETTING_PATHS = new Set([
  "streaming.enabled",
  "system.neteaseRealIp",
  "system.neteaseScrobbleEnabled",
  "system.neteaseScrobbleMode",
  "system.networkProxy",
]);

const CORE_OWNED_SETTING_PATHS = new Set(CORE_SETTING_PATHS);

const DEDICATED_CORE_SETTING_PATHS = new Set([
  "player.outputDevice",
  "player.volume",
  "player.lyricOffsets",
  "cache.dir",
  "download.dir",
]);

/** 判断配置读取/持久化的最终 authority 是否属于 Core Domain。 */
export const isCoreOwnedSettingPath = (keyPath: string): boolean => {
  if (CORE_OWNED_SETTING_PATHS.has(keyPath)) return true;
  return CORE_OWNED_SETTING_PREFIXES.some((prefix) => keyPath.startsWith(prefix));
};

/**
 * 判断配置是否属于 Core Domain 的通用 settings mutation。
 * 专用 output/cache/download/NowPlaying 路径继续走各自 domain client，避免绕过校验与副作用。
 */
export const isCoreSettingPath = (keyPath: string): boolean => {
  if (DEDICATED_CORE_SETTING_PATHS.has(keyPath)) return false;
  if (CORE_SETTING_PATHS.has(keyPath)) return true;
  return CORE_SETTING_PREFIXES.some((prefix) => keyPath.startsWith(prefix));
};
