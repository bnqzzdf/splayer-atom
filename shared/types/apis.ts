/**
 * 主进程音源 API 统一类型
 */

/** 支持的音源平台 */
export type ApiPlatform = "netease" | "qqmusic" | "kugou" | "qobuz" | "tidal";

/** Atom 主动维护并投影登录态的在线平台。 */
export type ManagedProviderPlatform = "netease" | "qobuz" | "tidal";

/** Control 可安全读取的 Provider session 投影，不包含 cookie/token。 */
export interface ProviderSessionState {
  authenticated: boolean;
  userId?: string;
  username?: string;
  countryCode?: string;
  expiresAt?: number;
  refreshable?: boolean;
}

export type ProviderSessionsSnapshot = Record<ManagedProviderPlatform, ProviderSessionState>;

/** 通用响应包装 */
export type ApiCallResponse =
  | { ok: true; status?: number; body?: unknown; data?: unknown }
  | { ok: false; error: string; status?: number; body?: unknown };

/** 渲染端统一入口 */
export interface ApisApi {
  /**
   * 调用任意音源接口
   * @param platform 音源平台
   * @param name 接口名
   * @param params 接口参数
   */
  call: (
    platform: ApiPlatform,
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<ApiCallResponse>;
  /**
   * 清空指定平台的登录态
   * @param platform 音源平台
   */
  clearSession: (platform: ApiPlatform) => Promise<void>;
  /** 获取 Core 权威 Provider session 投影。 */
  getSessions: () => Promise<ProviderSessionsSnapshot>;
  /** 订阅 Core Provider session 变化。 */
  onSessionsChange: (callback: (snapshot: ProviderSessionsSnapshot) => void) => () => void;
  /**
   * 打开官方网页登录
   * @param platform 音源平台
   * @returns 登录成功 `{ ok: true }`；用户取消 / 失败 `{ ok: false, error }`
   */
  openLoginWeb: (platform: ApiPlatform) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * 手动写入 cookie 登录（目前仅 netease）
   * @param platform 音源平台
   * @param cookie 形如 `MUSIC_U=xxx; __csrf=yyy` 的 cookie 字符串
   */
  setCookie: (
    platform: ApiPlatform,
    cookie: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}
