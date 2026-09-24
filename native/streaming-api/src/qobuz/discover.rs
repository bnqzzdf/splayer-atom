//! Qobuz 首页（发现页）与分类导航。
//!
//! 端点来自 play.qobuz.com bundle：
//!   - `discover/index`  → 首页聚合（榜单 / 新发行 / 推荐歌单等分区）
//!   - `genre/list`      → 分类（流派）导航
//!
//! 两者都需要登录态，因此 `auth_required = true`。

use serde_json::Value;
use std::collections::HashMap;

use super::QobuzClient;
use crate::error::StreamingError;

impl QobuzClient {
    /// 首页聚合：`discover/index`。
    ///
    /// 可选参数 `genre_id`（限定流派）、`limit` / `offset`。
    /// 返回体保留原始结构，由 Core/前端决定如何分区渲染。
    pub async fn discover_index(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let mut req_params = HashMap::new();

        if let Some(genre_id) = params
            .get("genre_id")
            .or_else(|| params.get("genreId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("genre_id".to_string(), genre_id.to_string());
        }

        if let Some(limit) = params.get("limit").and_then(Value::as_u64) {
            req_params.insert("limit".to_string(), limit.to_string());
        }
        if let Some(offset) = params.get("offset").and_then(Value::as_u64) {
            req_params.insert("offset".to_string(), offset.to_string());
        }

        self.request("discover/index", req_params, false, true, None)
            .await
    }

    /// 分类（流派）导航：`genre/list`。
    ///
    /// 可选参数 `parent_id`（子分类）、`locale`。
    pub async fn genre_list(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let mut req_params = HashMap::new();

        if let Some(parent_id) = params
            .get("parent_id")
            .or_else(|| params.get("parentId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("parent_id".to_string(), parent_id.to_string());
        }

        if let Some(locale) = params
            .get("locale")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("locale".to_string(), locale.to_string());
        }

        self.request("genre/list", req_params, false, true, None)
            .await
    }

    /// 单个发现分区的通用入口（`discover/newReleases` 等）。
    ///
    /// `section` 白名单化，避免把任意字符串拼进端点。
    pub async fn discover_section(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let section = params
            .get("section")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");

        const ALLOWED: [&str; 7] = [
            "newReleases",
            "playlists",
            "mostStreamed",
            "albumOfTheWeek",
            "pressAward",
            "qobuzissims",
            "idealDiscography",
        ];

        if !ALLOWED.contains(&section) {
            return Err(StreamingError::InvalidParam(format!(
                "Unsupported Qobuz discover section: {section}",
            )));
        }

        let mut req_params = HashMap::new();
        if let Some(genre_id) = params
            .get("genre_id")
            .or_else(|| params.get("genreId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            req_params.insert("genre_id".to_string(), genre_id.to_string());
        }
        if let Some(limit) = params.get("limit").and_then(Value::as_u64) {
            req_params.insert("limit".to_string(), limit.to_string());
        }
        if let Some(offset) = params.get("offset").and_then(Value::as_u64) {
            req_params.insert("offset".to_string(), offset.to_string());
        }

        let endpoint = format!("discover/{section}");
        self.request(&endpoint, req_params, false, true, None)
            .await
    }
}
