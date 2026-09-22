pub mod album;
pub mod artist;
pub mod auth;
pub mod config;
pub mod dash;
pub mod pkce;
pub mod playlist;
pub mod search;
pub mod song_url;
pub mod user;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::Value;

use crate::error::StreamingError;
use config::{TIDAL_API_BASE, TIDAL_DEFAULT_COUNTRY, TIDAL_USER_AGENT};

pub struct TidalClient {
    http: reqwest::Client,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub user_id: Option<String>,
    pub country_code: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    /// 自动刷新产生的新 token，交由 Core 在本次调用结束后持久化。
    refreshed_tokens: Mutex<Option<(String, Option<String>, Option<u64>)>>,
    /// 每个请求实例最多自动刷新一次，避免失效 refresh token 形成循环。
    refresh_attempted: AtomicBool,
}

impl TidalClient {
    pub fn new(
        access_token: Option<String>,
        refresh_token: Option<String>,
        user_id: Option<String>,
        country_code: Option<String>,
        client_id: Option<String>,
        client_secret: Option<String>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Self {
            http,
            access_token,
            refresh_token,
            user_id,
            country_code,
            client_id,
            client_secret,
            refreshed_tokens: Mutex::new(None),
            refresh_attempted: AtomicBool::new(false),
        }
    }

    pub async fn request(
        &self,
        endpoint: &str,
        params: HashMap<String, String>,
        auth_required: bool,
    ) -> Result<Value, StreamingError> {
        if auth_required && self.access_token.is_none() {
            return Err(StreamingError::Auth("TIDAL is not logged in".into()));
        }

        let mut query = params.clone();
        let country = self
            .country_code
            .as_deref()
            .unwrap_or(TIDAL_DEFAULT_COUNTRY);
        query
            .entry("countryCode".to_string())
            .or_insert_with(|| country.to_string());

        let url = format!("{}/{}", TIDAL_API_BASE, endpoint);
        let (status, body) = self
            .send_get(&url, &query, self.effective_token().as_deref())
            .await?;
        let sub_status = body.get("subStatus").and_then(Value::as_i64);

        if status.as_u16() == 401
            && sub_status == Some(11003)
            && self.refresh_token.is_some()
            && !self.refresh_attempted.swap(true, Ordering::SeqCst)
        {
            if let Ok(tokens) = self.auth_token_refresh(&HashMap::new()).await {
                let new_access = tokens
                    .get("accessToken")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let new_refresh = tokens
                    .get("refreshToken")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let expires_at = tokens.get("expiresAt").and_then(Value::as_u64);
                if !new_access.is_empty() {
                    *self
                        .refreshed_tokens
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                        Some((new_access.clone(), new_refresh.clone(), expires_at));
                    let (retry_status, retry_body) =
                        self.send_get(&url, &query, Some(&new_access)).await?;
                    if retry_status.is_success() {
                        return Ok(retry_body);
                    }
                    return Err(Self::api_error(retry_status.as_u16(), &retry_body));
                }
            }
        }

        if !status.is_success() {
            return Err(Self::api_error(status.as_u16(), &body));
        }

        Ok(body)
    }

    /// 使用当前 token 发起一次 API 请求。
    async fn send_get(
        &self,
        url: &str,
        query: &HashMap<String, String>,
        token: Option<&str>,
    ) -> Result<(reqwest::StatusCode, Value), StreamingError> {
        let mut req = self
            .http
            .get(url)
            .header("User-Agent", TIDAL_USER_AGENT)
            .query(query);
        if let Some(token) = token {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp
            .json()
            .await
            .map_err(|error| StreamingError::Parse(error.to_string()))?;
        Ok((status, body))
    }

    /// 返回自动刷新后的 token；Core 负责持久化它们。
    pub fn take_refreshed_tokens(&self) -> Option<(String, Option<String>, Option<u64>)> {
        self.refreshed_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }

    fn effective_token(&self) -> Option<String> {
        self.refreshed_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|(access, _, _)| access.clone())
            .or_else(|| self.access_token.clone())
    }

    /// 保留 TIDAL 原始错误和 subStatus，避免上层只能看到笼统的 403。
    fn api_error(status: u16, body: &Value) -> StreamingError {
        StreamingError::Api {
            status,
            message: Self::api_error_message(body),
        }
    }

    fn api_error_message(body: &Value) -> String {
        let raw = body
            .get("userMessage")
            .or_else(|| body.get("message"))
            .or_else(|| body.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown TIDAL API error");
        let sub_status = body.get("subStatus").and_then(Value::as_i64);
        let friendly = match sub_status {
            Some(11003) => "TIDAL token 已过期且自动刷新失败，请重新登录",
            Some(5003) => "TIDAL 订阅等级不允许该操作，请检查订阅状态",
            _ => raw,
        };
        let message = match sub_status {
            Some(sub_status) => format!("{friendly} [subStatus={sub_status} | {raw}]"),
            None => friendly.to_string(),
        };
        message
    }
}

#[cfg(test)]
mod tests {
    use super::TidalClient;
    use crate::error::StreamingError;
    use serde_json::json;

    #[test]
    fn tidal_expired_token_error_preserves_sub_status() {
        let error = TidalClient::api_error(
            401,
            &json!({
                "subStatus": 11003,
                "userMessage": "The access token has expired"
            }),
        );
        assert!(matches!(
            error,
            StreamingError::Api { status: 401, message }
                if message.contains("subStatus=11003")
                    && message.contains("The access token has expired")
        ));
    }

    #[test]
    fn tidal_subscription_error_is_not_reported_as_token_expiry() {
        let error = TidalClient::api_error(
            403,
            &json!({
                "subStatus": 5003,
                "userMessage": "Subscription required"
            }),
        );
        assert!(matches!(
            error,
            StreamingError::Api { status: 403, message }
                if message.contains("订阅等级")
                    && message.contains("subStatus=5003")
        ));
    }
}
