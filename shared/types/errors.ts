/**
 * 应用错误码
 *
 * 主进程在 catch 时根据调用上下文确定错误码返回给前端，
 * 前端通过 `handleError()` 查 i18n 翻译后 toast 提示。
 * 错误码同时作为 i18n 的 key（`errors.{code}`）。
 */
export enum ErrorCode {
  // 设备相关
  /** 未找到音频输出设备 */
  DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND",
  /** 音频设备初始化失败 */
  DEVICE_INIT_FAILED = "DEVICE_INIT_FAILED",
  /** Headless Core 尚未选择输出设备 */
  OUTPUT_DEVICE_REQUIRED = "OUTPUT_DEVICE_REQUIRED",

  // 文件相关
  /** 文件不存在或无法访问 */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  /** 文件中未找到音频流 */
  FILE_NO_AUDIO_STREAM = "FILE_NO_AUDIO_STREAM",
  /** 音频解码失败 */
  FILE_DECODE_ERROR = "FILE_DECODE_ERROR",
  /** 用户取消了文件选择 */
  FILE_NOT_SELECTED = "FILE_NOT_SELECTED",

  // 网络相关
  /** 音源连接失败 */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** 音源响应超时 */
  NETWORK_TIMEOUT = "NETWORK_TIMEOUT",

  // 在线源相关
  /** 无法获取播放地址（API + 插件都失败） */
  URL_RESOLVE_FAILED = "URL_RESOLVE_FAILED",
  /** 未找到支持该平台的插件 */
  NO_PLUGIN_AVAILABLE = "NO_PLUGIN_AVAILABLE",
  /** 在线平台登录态已失效 */
  NETEASE_LOGIN_EXPIRED = "NETEASE_LOGIN_EXPIRED",
  /** 在线歌曲需要会员权益 */
  NETEASE_VIP_REQUIRED = "NETEASE_VIP_REQUIRED",
  /** 在线歌曲需要单独购买数字单曲/专辑 */
  NETEASE_PURCHASE_REQUIRED = "NETEASE_PURCHASE_REQUIRED",
  /** 在线歌曲仅有试听源且试听播放被禁用 */
  NETEASE_TRIAL_DISABLED = "NETEASE_TRIAL_DISABLED",
  /** 在线歌曲暂无可用官方音源 */
  NETEASE_UNAVAILABLE = "NETEASE_UNAVAILABLE",
  // 平台无关的在线源权益错误：用于 Core 不直接解析、由插件返回音源的平台（QM / KG 等）
  /** 需要该平台会员权益 */
  PROVIDER_VIP_REQUIRED = "PROVIDER_VIP_REQUIRED",
  /** 需要单独购买数字单曲/专辑 */
  PROVIDER_PURCHASE_REQUIRED = "PROVIDER_PURCHASE_REQUIRED",
  /** 仅提供试听且试听播放被禁用 */
  PROVIDER_TRIAL_DISABLED = "PROVIDER_TRIAL_DISABLED",
  /** 该平台暂无可用音源（无版权 / 已下架等） */
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
  /** 需要先登录该在线平台（QM/KG 未登录时取不到直链） */
  PROVIDER_LOGIN_REQUIRED = "PROVIDER_LOGIN_REQUIRED",

  // 标签编辑相关
  /** 读取文件标签失败 */
  TAG_READ_FAILED = "TAG_READ_FAILED",
  /** 写入文件标签失败 */
  TAG_WRITE_FAILED = "TAG_WRITE_FAILED",

  // 扫描相关
  /** 未配置扫描目录 */
  SCAN_NO_DIRS = "SCAN_NO_DIRS",
  /** 扫描目录已存在 */
  SCAN_DIR_EXISTS = "SCAN_DIR_EXISTS",
  /** 扫描目录不存在 */
  SCAN_DIR_NOT_FOUND = "SCAN_DIR_NOT_FOUND",
  /** 用户取消了目录选择 */
  SCAN_DIR_NOT_SELECTED = "SCAN_DIR_NOT_SELECTED",

  // 通用
  /** 加载已被更新的 load/stop 取代（快速切歌、停止），属正常竞态结果，前端静默处理 */
  LOAD_SUPERSEDED = "LOAD_SUPERSEDED",
  /** 连续播放失败达到上限 */
  MAX_CONSECUTIVE_FAILURES = "MAX_CONSECUTIVE_FAILURES",
  /** 未知错误 */
  UNKNOWN = "UNKNOWN",
}
