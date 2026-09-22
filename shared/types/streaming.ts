import type { Album, Artist, Playlist, Track } from "./player";

/** 支持的流媒体服务器类型 */
export type StreamingServerType =
  "subsonic" | "navidrome" | "opensubsonic" | "airsonic" | "gonic" | "lms" | "jellyfin" | "emby";

/** 服务器配置视图 */
export interface StreamingServerConfig {
  /** 唯一标识符 */
  id: string;
  /** 服务器显示名称 */
  name: string;
  /** 服务器类型 */
  type: StreamingServerType;
  /** 服务器地址 */
  url: string;
  /** 账号用户名 */
  username: string;
  /** 主进程是否已经保存密码 */
  hasPassword: boolean;
  /** 最后一次连接成功的时间戳（ms） */
  lastConnected?: number;
}

/** 主进程运行时完整服务器配置 */
export interface StreamingRuntimeConfig extends StreamingServerConfig {
  /** 明文密码 */
  password: string;
  /** 会话 Token */
  accessToken?: string;
  /** 用户 ID */
  userId?: string;
}

/** 服务器表单提交输入 */
export interface StreamingServerInput {
  /** 服务器显示名称 */
  name: string;
  /** 服务器类型 */
  type: StreamingServerType;
  /** 服务器地址 */
  url: string;
  /** 账号用户名 */
  username: string;
  /** 账号密码 */
  password: string;
}

/** 错误归类 */
export type StreamingErrorCode = "auth" | "network" | "protocol" | "unknown";

/** Core 持有的激活流媒体服务器运行时连接状态。 */
export interface StreamingConnectionStatus {
  connected: boolean;
  error?: string;
  errorCode?: StreamingErrorCode;
}

/** Core 流媒体配置 + 当前运行时连接投影。 */
export interface StreamingConfigSnapshot {
  servers: StreamingServerConfig[];
  activeServerId: string | null;
  connectionStatus: StreamingConnectionStatus;
}

/** 连通性测试结果 */
export interface StreamingPingResult {
  /** 是否连通成功 */
  ok: boolean;
  /** 服务器版本号 */
  version?: string;
  /** 失败描述信息 */
  error?: string;
  /** 失败错误码 */
  code?: StreamingErrorCode;
}

/** 连接操作结果 */
export type StreamingConnectResult =
  | { ok: true; server: StreamingServerConfig }
  | { ok: false; error: string; code: StreamingErrorCode };

/** 列表请求通用参数 */
export interface StreamingListParams {
  /** 分页偏移量 */
  offset?: number;
  /** 单页限制条数 */
  limit?: number;
}

/** 搜索结果聚合 */
export interface StreamingSearchResult {
  /** 匹配的歌曲列表 */
  songs: Track[];
  /** 匹配的专辑列表 */
  albums: Album[];
  /** 匹配的歌手列表 */
  artists: Artist[];
  /** 匹配的歌单列表 */
  playlists: Playlist[];
}

/** 流媒体服务器媒体快照 */
export interface StreamingLibrarySnapshot {
  /** 全量歌曲列表 */
  songs: Track[];
  /** 全量专辑列表 */
  albums: Album[];
  /** 全量歌手列表 */
  artists: Artist[];
  /** 全量歌单列表 */
  playlists: Playlist[];
}
