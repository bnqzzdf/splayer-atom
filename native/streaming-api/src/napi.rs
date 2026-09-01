use napi_derive::napi;
use serde_json::Value;

use crate::provider::call_provider;

/// Node Core 的 Qobuz/TIDAL 原生协议入口。
///
/// Node Core 负责 session、凭据持久化与业务策略；本函数只执行一次平台协议调用。
#[cfg_attr(test, allow(dead_code))]
#[napi]
pub async fn call_streaming_provider(
    platform: String,
    action: String,
    auth: Value,
    params: Value,
) -> napi::Result<Value> {
    call_provider(&platform, &action, auth, params)
        .await
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}
