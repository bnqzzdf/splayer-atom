//! TIDAL 首页（pages）与分类导航。
//!
//! 端点（api.tidal.com/v1）：
//!   - `pages/home`  → 首页分区（sections，含专辑/歌单/艺人等条目）
//!   - `genres`      → 分类（流派）导航
//!
//! 两者都需要登录态，因此 `auth_required = true`。
//! countryCode 由 `TidalClient::request` 自动补齐。

use serde_json::Value;
use std::collections::HashMap;

use super::TidalClient;
use crate::error::StreamingError;

impl TidalClient {
    /// 首页分区：`pages/home`。
    ///
    /// `deviceType` 是**必填**参数（缺了会回 400 "deviceType missing"），
    /// 因此这里给默认值 `DESKTOP`，调用方仍可覆盖。
    /// 返回 `{ id, title, rows: [{ modules: [{ type, items }] }] }`。
    pub async fn pages_home(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let mut req_params = HashMap::new();

        if let Some(locale) = params
            .get("locale")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("locale".to_string(), locale.to_string());
        }

        let device_type = params
            .get("device_type")
            .or_else(|| params.get("deviceType"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("DESKTOP");
        req_params.insert("deviceType".to_string(), device_type.to_string());

        self.request("pages/home", req_params, true).await
    }

    /// 指定页面：`pages/{pageId}`。
    ///
    /// `pageId` 支持两段路径 `data/<uuid>`：首页每个模块在 `pagedList.dataApiPath`
    /// 里给出 `pages/data/<uuid>`，「查看全部」就是拿它翻页。两段都按纯标识符校验，
    /// 避免把任意字符串拼进端点。
    ///
    /// `deviceType` 与 `pages/home` 一样是必填参数（缺了会回 400 "deviceType missing"），
    /// `limit` / `offset` 用于翻页。
    pub async fn pages_get(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let page_id = params
            .get("page_id")
            .or_else(|| params.get("pageId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");

        let is_identifier = |value: &str| {
            !value.is_empty()
                && value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        };
        let segments: Vec<&str> = page_id.split('/').collect();
        let valid = !page_id.is_empty()
            && page_id.len() <= 96
            && segments.len() <= 2
            && segments.iter().all(|segment| is_identifier(segment));

        if !valid {
            return Err(StreamingError::InvalidParam(format!(
                "Invalid TIDAL page id: {page_id}",
            )));
        }

        let mut req_params = HashMap::new();
        if let Some(locale) = params
            .get("locale")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("locale".to_string(), locale.to_string());
        }

        let device_type = params
            .get("device_type")
            .or_else(|| params.get("deviceType"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("DESKTOP");
        req_params.insert("deviceType".to_string(), device_type.to_string());

        if let Some(limit) = params.get("limit").and_then(Value::as_u64) {
            req_params.insert("limit".to_string(), limit.to_string());
        }
        if let Some(offset) = params.get("offset").and_then(Value::as_u64) {
            req_params.insert("offset".to_string(), offset.to_string());
        }

        let endpoint = format!("pages/{page_id}");
        self.request(&endpoint, req_params, true).await
    }

    /// 分类（流派）导航：`genres`。
    pub async fn genres(&self, params: &HashMap<String, Value>) -> Result<Value, StreamingError> {
        let mut req_params = HashMap::new();

        if let Some(locale) = params
            .get("locale")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("locale".to_string(), locale.to_string());
        }

        self.request("genres", req_params, true).await
    }
}
