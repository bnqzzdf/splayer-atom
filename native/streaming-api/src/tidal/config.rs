pub const TIDAL_API_BASE: &str = "https://api.tidal.com/v1";
pub const TIDAL_AUTH_BASE: &str = "https://auth.tidal.com/v1/oauth2";
pub const TIDAL_LOGIN_BASE: &str = "https://login.tidal.com";
pub const TIDAL_OPENAPI_BASE: &str = "https://openapi.tidal.com";

pub const TIDAL_DEFAULT_COUNTRY: &str = "US";

/// 授权范围：只申请真正用得到的「读用户资料 + 写用户资料」。
///
/// 这里不再包含 `w_sub`（写订阅）——它在整个代码库里从未被使用，
/// 却会让服务端拒绝刷新：
///   400 One or more of the requested scopes are not allowed.
///   Requested scopes: [READ_USR_DATA, WRITE_USR, WRITE_SUBSCRIPTION]
///   allowed scopes:   [READ_USR_DATA, WRITE_USR]
/// authorize 阶段服务端会把未授权范围静默收窄，但 refresh 阶段严格校验，
/// 于是 access token 一过期就刷不回来。保持与已授权集合一致即可。
pub const TIDAL_SCOPE: &str = "r_usr+w_usr";

/// 官方移动客户端 Client ID（公共客户端，无 secret）
/// 享受最高 Entitlement 权限：标准 LOSSLESS / Hi-Res 不被降级为 AAC。
pub const TIDAL_OFFICIAL_CLIENT_ID: &str = "YUJf8vfXOxVvzo2W";
pub const TIDAL_ANDROID_REDIRECT_URI: &str = "https://com.player.tidal/auth";

/// 备选 Client ID/Secret
pub const TIDAL_DEFAULT_CLIENT_ID: &str = "fX2JxdmntZWK0ixT";
pub const TIDAL_DEFAULT_CLIENT_SECRET: &str = "1Nn9AfDAjrrgJFJbKNWLeAyKHVGmINuXPPLHVXAvxAg=";

pub const TIDAL_USER_AGENT: &str = "TIDAL/6.2.0 (Android; 14; en-US)";
pub const TIDAL_V2_CONTENT_TYPE: &str = "application/vnd.tidal.v1+json";
