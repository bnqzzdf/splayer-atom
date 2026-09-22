use serde_json::{json, Value};
use std::collections::HashMap;

use super::QobuzClient;
use crate::error::StreamingError;

impl QobuzClient {
    /// 验证/登录 Qobuz。
    ///
    /// 推荐：只给 `userAuthToken`（userId 可选，缺省时由 `user/get` 反查真实用户）。
    /// 兼容：`userId` + `userAuthToken` 一起给。
    /// 注意：`email` + `password` 分支保留但**实测不可用**——Qobuz 对该 app_id
    /// 连 `user/login` 都返回 401 User authentication is required（加签名亦然），
    /// 因此前端不暴露邮箱密码入口。
    pub async fn auth_login(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let user_id = params
            .get("userId")
            .or_else(|| params.get("user_id"))
            .and_then(Value::as_str);

        let user_auth_token = params
            .get("userAuthToken")
            .or_else(|| params.get("user_auth_token"))
            .or_else(|| params.get("token"))
            .and_then(Value::as_str);

        let mut req_params = HashMap::new();

        // 只要给了 token 就走 token 分支：userId 现在是**可选**的。
        // 网页播放器里 user_id 与 token 是一起给的，但 Qobuz 能凭 token 反查用户，
        // 所以「只粘 token」也能登录——少一个要用户去 F12 里翻的字段。
        if let Some(tok) = user_auth_token {
            let uid = user_id.unwrap_or("");
            if !uid.is_empty() {
                req_params.insert("user_id".to_string(), uid.to_string());
            }

            let client = QobuzClient::new(
                Some(tok.to_string()),
                if uid.is_empty() { None } else { Some(uid.to_string()) },
            );
            let user_info = client
                .request("user/get", req_params, false, true, None)
                .await?;

            let user = user_info.get("user").cloned().unwrap_or(user_info);
            let display_name = user
                .get("display_name")
                .or_else(|| user.get("email"))
                .and_then(Value::as_str)
                .unwrap_or("Qobuz User");
            // userId 缺省时以服务端返回的真实 id 为准（token 所属用户）
            let resolved_id = user
                .get("id")
                .map(|v| match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| uid.to_string());

            let has_subscription = user
                .get("subscription")
                .and_then(|s| s.get("is_active"))
                .and_then(Value::as_bool)
                .unwrap_or(false);

            let max_quality = user
                .get("credential")
                .and_then(|c| c.get("max_format_id"))
                .and_then(Value::as_i64)
                .unwrap_or(5);

            Ok(json!({
                "status": "success",
                "user_id": resolved_id,
                "user_auth_token": tok,
                "display_name": display_name,
                "user": {
                    "id": resolved_id,
                    "login": display_name,
                    "display_name": display_name,
                },
                "is_active": has_subscription,
                "max_format_id": max_quality,
            }))
        } else {
            let email = params
                .get("email")
                .or_else(|| params.get("username"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let password = params.get("password").and_then(Value::as_str).unwrap_or("");

            if email.is_empty() || password.is_empty() {
                return Err(StreamingError::InvalidParam(
                    "Missing userId/userAuthToken or email/password".into(),
                ));
            }

            req_params.insert("username".to_string(), email.to_string());
            req_params.insert("password".to_string(), password.to_string());

            let res = self
                .request("user/login", req_params, false, false, None)
                .await?;

            let token = res
                .get("user_auth_token")
                .and_then(Value::as_str)
                .unwrap_or("");
            let uid = res
                .get("user")
                .and_then(|u| u.get("id"))
                .map(|v| v.to_string())
                .unwrap_or_default();

            Ok(json!({
                "status": "success",
                "user_id": uid,
                "user_auth_token": token,
                "raw": res,
            }))
        }
    }

    pub async fn auth_status(&self) -> Result<Value, StreamingError> {
        if self.user_auth_token.is_some() {
            let mut params = HashMap::new();
            if let Some(uid) = &self.user_id {
                params.insert("user_id".to_string(), uid.clone());
            }
            match self.request("user/get", params, false, true, None).await {
                Ok(user_info) => {
                    let user = user_info.get("user").cloned().unwrap_or(user_info);
                    let display_name = user
                        .get("display_name")
                        .or_else(|| user.get("email"))
                        .and_then(Value::as_str)
                        .unwrap_or("Qobuz User");

                    let is_active = user
                        .get("subscription")
                        .and_then(|s| s.get("is_active"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false);

                    let max_format_id = user
                        .get("credential")
                        .and_then(|c| c.get("max_format_id"))
                        .and_then(Value::as_i64)
                        .unwrap_or(5);

                    Ok(json!({
                        "loggedIn": true,
                        "userId": self.user_id,
                        "username": display_name,
                        "hasSubscription": is_active,
                        "maxFormatId": max_format_id,
                    }))
                }
                Err(_) => Ok(json!({ "loggedIn": false })),
            }
        } else {
            Ok(json!({ "loggedIn": false }))
        }
    }

    pub async fn auth_logout(&self) -> Result<Value, StreamingError> {
        let _ = self
            .request("user/logout", HashMap::new(), false, false, None)
            .await;
        Ok(json!({ "status": "success", "loggedIn": false }))
    }
}
