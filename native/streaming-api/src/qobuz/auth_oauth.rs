//! Qobuz 一键 OAuth 登录（authorization code + 一次性本地回调）。
//!
//! 流程（详见 `docs/qobuz-oauth-plan.md`）：
//!   1. `auth_oauth_start`：起一次性监听，返回带 `redirect_url` 的授权 URL；
//!   2. 用户在浏览器里正常登录 Qobuz，浏览器回跳到本机回调地址并带上 `code_autorisation`；
//!   3. `auth_oauth_await`：等回调 → 用 `oauth/callback` 兑换 `user_auth_token` → 回 `user/get` 投影会话。
//!
//! 监听只在登录期间存活：拿到回调、超时（180s）或兑换失败即关闭。

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

use super::credentials::get_credentials;
use super::QobuzClient;
use crate::error::StreamingError;

/// 本地回调路径。其余路径一律 404，避免 favicon 之类的杂请求把一次性监听消耗掉。
const CALLBACK_PATH: &str = "/qobuz/cb";
/// 授权总时长上限；超时后监听自动关闭并返回可读错误。
const OAUTH_TIMEOUT_SECS: u64 = 180;

/// 网页播放器初始化 (initialization) 值中的 `private_key`。
///
/// 与 `credentials.rs` 的 `PROD_INIT` 同源——都是 play.qobuz.com bundle 里的初始化常量。
/// 实测来源：`bundle.js` → `authenticate({privateKey:"...",code:...})`
/// → `requester.get("oauth/callback",{query:{code,private_key}})`。
const WEB_PRIVATE_KEY: &str = "6lz8C03UDIC7";

/// 一次性回调监听的结果。
enum CallbackOutcome {
    /// 拿到授权码。
    Code(String),
    /// 用户拒绝授权、超时，或本地监听出错。
    Failed(StreamingError),
}

/// 一次进行中的 OAuth 登录。
struct PendingOauth {
    /// 回调结果由监听任务经此送回 `auth_oauth_await`。
    code_rx: Option<oneshot::Receiver<CallbackOutcome>>,
    /// 新的 start 到来时用它叫停上一轮监听，避免旧端口白占 180 秒。
    cancel_tx: Option<oneshot::Sender<()>>,
    /// 监听端口，用于日志与诊断。
    port: u16,
}

fn pending_slot() -> &'static Mutex<Option<PendingOauth>> {
    static PENDING: OnceLock<Mutex<Option<PendingOauth>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn first_str<'a>(params: &'a HashMap<String, Value>, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| params.get(*name).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// 把 `user/get` 的响应投影成前端 `providerSessions` 需要的形状。
///
/// `auth_login` 与 OAuth 走同一套投影，避免两条登录路径出现字段差异。
fn project_session(user_info: Value, uid: &str, token: &str) -> Value {
    let user = user_info.get("user").cloned().unwrap_or(user_info);

    let display_name = user
        .get("display_name")
        .or_else(|| user.get("email"))
        .and_then(Value::as_str)
        .unwrap_or("Qobuz User");

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

    json!({
        "status": "success",
        "user_id": uid,
        "user_auth_token": token,
        "display_name": display_name,
        "user": {
            "id": uid,
            "login": display_name,
            "display_name": display_name,
        },
        "is_active": has_subscription,
        "max_format_id": max_quality,
    })
}

/// 写回一个最小 HTTP 响应并关闭连接。
async fn write_response(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        len = body.len(),
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

/// GET 请求行里 path 部分是否就是本地回调路径（允许带 query）。
fn path_matches(request_line: &str, expected_path: &str) -> bool {
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return false;
    };
    let path = target.split('?').next().unwrap_or(target);
    path == expected_path
}

/// 解析请求行 query 部分为键值表（值做百分号解码）。
///
/// 用精确的键匹配而不是子串 `contains`，否则 `?noterror=1` 会被误判成授权失败。
fn parse_query(request_line: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return out;
    };
    let Some(query) = target.split_once('?').map(|(_, q)| q) else {
        return out;
    };
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let decoded = urlencoding::decode(value)
            .map(|value| value.trim().to_string())
            .unwrap_or_else(|_| value.to_string());
        out.insert(key.to_string(), decoded);
    }
    out
}

/// 从 `GET /qobuz/cb?code_autorisation=xxxx HTTP/1.1` 中取出授权码。
///
/// Qobuz 实测回传 `code_autorisation`；同时兼容标准 OAuth 的 `code`。
fn code_from_request_line(request_line: &str) -> Option<String> {
    let query = parse_query(request_line);
    for key in ["code_autorisation", "code"] {
        if let Some(value) = query.get(key) {
            if !value.is_empty() {
                return Some(value.clone());
            }
        }
    }
    None
}

/// 成功页：告诉用户可以关掉标签页了。
const SUCCESS_PAGE: &str = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
<title>Qobuz 登录成功</title></head><body style=\"font-family:system-ui,sans-serif;\
text-align:center;padding:56px;background:#121212;color:#f5f5f5;\">\
<h2 style=\"color:#6ee7f7;\">Qobuz 登录成功</h2>\
<p>已收到授权，请关闭本页并返回 Atom。</p></body></html>";

/// 回调页带了 `error`（例如用户拒绝授权）时展示的失败页。
const DENIED_PAGE: &str = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
<title>Qobuz 授权未完成</title></head><body style=\"font-family:system-ui,sans-serif;\
text-align:center;padding:56px;background:#121212;color:#f5f5f5;\">\
<h2 style=\"color:#ff8a80;\">授权未完成</h2>\
<p>请在 Atom 中重试，或改用「粘贴 Token」方式登录。</p></body></html>";

const NOT_FOUND_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\">\
<title>404</title></head><body>Not Found</body></html>";

/// 等一次回调，返回授权码。
///
/// 只接受 `GET /qobuz/cb`：其它路径（favicon、探测请求）回 404 后继续等待，
/// 这样一次性监听不会被无关请求吃掉。
async fn wait_for_callback(
    listener: TcpListener,
    callback_path: String,
    expected_state: Option<String>,
    mut cancel_rx: oneshot::Receiver<()>,
) -> CallbackOutcome {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECS);

    loop {
        let accepted = tokio::select! {
            // 新的 start 到来：立刻放弃并释放端口，而不是让旧端口白占 180 秒。
            _ = &mut cancel_rx => {
                return CallbackOutcome::Failed(StreamingError::Auth(
                    "本次 Qobuz 授权已被新的登录请求取代".into(),
                ));
            }
            result = tokio::time::timeout_at(deadline, listener.accept()) => result,
        };
        let (mut stream, _peer) = match accepted {
            Ok(Ok(pair)) => pair,
            // Listener 在此 drop，端口随即释放。
            Ok(Err(error)) => {
                return CallbackOutcome::Failed(StreamingError::Other(format!(
                    "本地回调监听失败: {error}"
                )))
            }
            Err(_) => {
                return CallbackOutcome::Failed(StreamingError::Auth(format!(
                    "Qobuz 授权超时（{OAUTH_TIMEOUT_SECS} 秒内未收到浏览器回调），请重试"
                )))
            }
        };

        // 请求行足够小，一次读固定缓冲即可判定。
        let mut buffer = vec![0u8; 8192];
        let read =
            match tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buffer)).await {
                Ok(Ok(n)) => n,
                // 单个连接读取失败/超时不影响整体等待。
                _ => continue,
            };
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let request_line = request.lines().next().unwrap_or_default().to_string();

        if !path_matches(&request_line, &callback_path) {
            write_response(&mut stream, "404 Not Found", NOT_FOUND_PAGE).await;
            continue;
        }

        let query = parse_query(&request_line);

        // 拒绝授权优先于 state 校验：Qobuz 的拒绝回调同样可能不带 state，
        // 若先校验 state 会把它当成非法请求而空等到超时。
        if query.contains_key("error") {
            write_response(&mut stream, "200 OK", DENIED_PAGE).await;
            return CallbackOutcome::Failed(StreamingError::Auth("用户取消了 Qobuz 授权".into()));
        }

        // Qobuz 可能不保留 redirect_url 的 query，因此校验随机回调路径；
        // 若 state 被带回，还要与同一个随机值一致。
        if let Some(expected) = &expected_state {
            if let Some(got) = query.get("state") {
                if got != expected {
                    write_response(&mut stream, "400 Bad Request", NOT_FOUND_PAGE).await;
                    continue;
                }
            }
        }

        let Some(code) = code_from_request_line(&request_line) else {
            write_response(&mut stream, "400 Bad Request", NOT_FOUND_PAGE).await;
            continue;
        };

        write_response(&mut stream, "200 OK", SUCCESS_PAGE).await;
        return CallbackOutcome::Code(code);
    }
}

impl QobuzClient {
    /// 起一次性本地回调监听，返回授权 URL。
    ///
    /// 返回 `{ url, port, redirectUri, state }`。
    pub async fn auth_oauth_start(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let creds = get_credentials(&self.http, false).await?;
        // 允许调用方覆盖 app_id，便于将来换应用；默认与网页播放器一致。
        let app_id = first_str(params, &["appId", "app_id"])
            .map(str::to_string)
            .unwrap_or_else(|| creds.app_id.clone());

        // 浏览器跑在哪台机器上，决定了回调地址与监听范围。
        //
        // 授权页由 Web Control 前端的 `window.open` 打开，而 Web Control 跑在
        // 用户的 PC 上（设备本身无图形浏览器）。此时 `127.0.0.1` 指向那台 PC
        // 而不是本机，回调永远回不来 —— 必须用 Core 对外可达的地址。
        // 前端把自己的 host 传进来；不传则退回本机监听（同机场景）。
        let redirect_host = first_str(params, &["redirectHost", "redirect_host", "host"]);
        let host = redirect_host.unwrap_or("127.0.0.1");
        if !host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        {
            return Err(StreamingError::InvalidParam(
                "无效的 Qobuz 回调主机名".into(),
            ));
        }
        let is_loopback = host == "localhost" || host.starts_with("127.");
        let bind_addr = if is_loopback { "127.0.0.1" } else { "0.0.0.0" };

        // 端口交给系统分配，避免固定端口冲突。
        let listener = TcpListener::bind((bind_addr, 0)).await.map_err(|error| {
            StreamingError::Other(format!("无法监听回调端口 {bind_addr}: {error}"))
        })?;
        let port = listener
            .local_addr()
            .map_err(|error| StreamingError::Other(format!("无法获取回调端口: {error}")))?
            .port();

        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|error| {
            StreamingError::Other(format!("无法生成 Qobuz 授权随机数: {error}"))
        })?;
        let state = nonce
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        // 随机值同时放进路径和 state：即使 Qobuz 丢弃 query，回调仍可校验。
        let callback_path = format!("{CALLBACK_PATH}/{state}");
        let redirect_uri = format!("http://{host}:{port}{callback_path}?state={state}");

        let auth_url = format!(
            "https://www.qobuz.com/signin/oauth?ext_app_id={}&redirect_url={}&state={}",
            urlencoding::encode(&app_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(&state),
        );

        let (code_tx, code_rx) = oneshot::channel::<CallbackOutcome>();
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

        // 新的一次登录作废旧的一次：旧监听会立刻释放端口，
        // 而不是继续占着端口等满自己的 180 秒。
        {
            let mut slot = pending_slot().lock().await;
            if let Some(previous) = slot.take() {
                if let Some(cancel) = previous.cancel_tx {
                    let _ = cancel.send(());
                }
            }
            *slot = Some(PendingOauth {
                code_rx: Some(code_rx),
                cancel_tx: Some(cancel_tx),
                port,
            });
        }

        let expected_state = Some(state.clone());
        tokio::spawn(async move {
            let outcome =
                wait_for_callback(listener, callback_path, expected_state, cancel_rx).await;
            // 回调可能早于前端的 await 请求；保留槽位供 await 读取结果。
            let _ = code_tx.send(outcome);
        });

        Ok(json!({
            "status": "success",
            "url": auth_url,
            "port": port,
            "redirectUri": redirect_uri,
            "state": state,
            "expiresIn": OAUTH_TIMEOUT_SECS,
        }))
    }

    /// 等待浏览器回调并兑换 token，返回与 `auth_login` 相同的会话形状。
    pub async fn auth_oauth_await(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        // 只取走 receiver，**保留槽位里的 cancel_tx**：
        // 若把整个槽位 take 掉，cancel_tx 会被 drop，监听任务会误以为
        // 被新一轮取代而立刻放弃这次登录。
        // 监听任务结束时会自行清空槽位，因此失败后重试仍能得到干净状态。
        let (code_rx, port) = {
            let mut slot = pending_slot().lock().await;
            let Some(pending) = slot.as_mut() else {
                return Err(StreamingError::InvalidParam(
                    "没有进行中的 Qobuz 授权，请先调用 auth_oauth_start".into(),
                ));
            };
            let port = pending.port;
            let code_rx = pending
                .code_rx
                .take()
                .ok_or_else(|| StreamingError::InvalidParam("本次 Qobuz 授权已在等待中".into()))?;
            (code_rx, port)
        };

        let received = tokio::time::timeout(Duration::from_secs(OAUTH_TIMEOUT_SECS + 15), code_rx)
            .await
            .map_err(|_| {
                StreamingError::Auth(format!(
                    "Qobuz 授权超时（{OAUTH_TIMEOUT_SECS} 秒内未完成登录），请重试"
                ))
            })?
            .map_err(|_| StreamingError::Auth("Qobuz 授权已取消，请重试".into()))?;

        let mut slot = pending_slot().lock().await;
        if slot.as_ref().map(|pending| pending.port) == Some(port) {
            slot.take();
        }
        drop(slot);

        let code = match received {
            CallbackOutcome::Code(code) => code,
            CallbackOutcome::Failed(error) => return Err(error),
        };

        let creds = get_credentials(&self.http, false).await?;
        let app_id = first_str(params, &["appId", "app_id"])
            .map(str::to_string)
            .unwrap_or_else(|| creds.app_id.clone());
        let private_key = first_str(params, &["privateKey", "private_key"])
            .map(str::to_string)
            .unwrap_or_else(|| WEB_PRIVATE_KEY.to_string());

        let (token, uid) = self.exchange_code(&code, &private_key, &app_id).await?;

        // 与 auth_login 一致：token 与 user_id 都从服务端反查，保证 userId 是真实用户 id。
        let mut req_params = HashMap::new();
        if !uid.is_empty() {
            req_params.insert("user_id".to_string(), uid.clone());
        }
        let client = QobuzClient::new(
            Some(token.clone()),
            if uid.is_empty() {
                None
            } else {
                Some(uid.clone())
            },
        );
        let user_info = client
            .request("user/get", req_params, false, true, None)
            .await?;
        let user = user_info.get("user").cloned().unwrap_or(user_info);
        let resolved_id = user
            .get("id")
            .map(|value| match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            })
            .filter(|value| !value.is_empty())
            .unwrap_or(uid);

        Ok(project_session(
            json!({ "user": user }),
            &resolved_id,
            &token,
        ))
    }

    /// 用回调拿到的 code 兑换 `user_auth_token`。
    ///
    /// 该端点**不需要请求签名**：网页播放器直接 `GET oauth/callback`
    /// 并只带 `code` + `private_key` 两个 query 参数（app_id 走 `X-App-Id` 头）。
    async fn exchange_code(
        &self,
        code: &str,
        private_key: &str,
        app_id: &str,
    ) -> Result<(String, String), StreamingError> {
        let query = [
            ("code", code),
            ("private_key", private_key),
            // 网页播放器会自动补 app_id；显式带上以保证与签名路径行为一致。
            ("app_id", app_id),
        ];

        let url = format!("{}/oauth/callback", super::config::QOBUZ_API_BASE);
        let response = self
            .http
            .get(&url)
            .header("X-App-Id", app_id)
            .query(&query)
            .send()
            .await?;

        let status = response.status();
        let body: Value = response
            .json()
            .await
            .map_err(|error| StreamingError::Parse(error.to_string()))?;

        if !status.is_success() {
            let message = body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Qobuz 授权码兑换失败");
            return Err(StreamingError::Api {
                status: status.as_u16(),
                message: message.to_string(),
            });
        }

        // 实测响应形状未确证，因此对 token / userId 都做多键兼容。
        let token = first_str_from_value(
            &body,
            &["user_auth_token", "token", "auth_token", "userAuthToken"],
        )
        .ok_or_else(|| StreamingError::Parse("Qobuz 兑换响应缺少 user_auth_token".into()))?;

        let uid = first_str_from_value(&body, &["user_id", "userId", "id"]).unwrap_or_default();

        Ok((token, uid))
    }
}

/// 从 JSON 对象里按候选键取第一个非空字符串（数字会被转成字符串）。
fn first_str_from_value(value: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        value.get(*name).and_then(|candidate| match candidate {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    use super::{
        code_from_request_line, first_str_from_value, parse_query, path_matches, project_session,
        wait_for_callback, CallbackOutcome, CALLBACK_PATH,
    };

    /// 起一个监听任务；返回 (任务句柄, 端口, 取消通道的保持者)。
    ///
    /// 调用方必须持有 `cancel_tx`，否则 sender 被 drop 会让监听立刻收到取消信号。
    async fn spawn_listener(
        expected_state: Option<String>,
    ) -> (
        tokio::task::JoinHandle<CallbackOutcome>,
        u16,
        oneshot::Sender<()>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            wait_for_callback(
                listener,
                CALLBACK_PATH.to_string(),
                expected_state,
                cancel_rx,
            )
            .await
        });
        (handle, port, cancel_tx)
    }

    /// 发一个原始请求到监听端口。
    async fn send(port: u16, target: &str) {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        drop(stream);
    }

    #[test]
    fn matches_only_the_configured_callback_path() {
        let secret_path = format!("{CALLBACK_PATH}/secret");
        assert!(path_matches(
            &format!("GET {secret_path}?code_autorisation=abcd1234 HTTP/1.1"),
            &secret_path,
        ));
        assert!(!path_matches(
            &format!("GET {CALLBACK_PATH}?code=x HTTP/1.1"),
            &secret_path
        ));
        assert!(!path_matches("GET /favicon.ico HTTP/1.1", &secret_path));
        assert!(!path_matches("", &secret_path));
    }

    #[test]
    fn extracts_authorization_code_from_live_callback_shape() {
        // 实测落地形状：play.qobuz.com 用的是 8 位 code_autorisation。
        let line = format!("GET {CALLBACK_PATH}?code_autorisation=HUukQqWc HTTP/1.1");
        assert_eq!(code_from_request_line(&line).as_deref(), Some("HUukQqWc"));
    }

    #[test]
    fn accepts_standard_oauth_code_parameter_as_fallback() {
        let line = format!("GET {CALLBACK_PATH}?state=abc&code=xyz789 HTTP/1.1");
        assert_eq!(code_from_request_line(&line).as_deref(), Some("xyz789"));
    }

    #[test]
    fn ignores_requests_without_a_code() {
        let line = format!("GET {CALLBACK_PATH}?foo=bar HTTP/1.1");
        assert_eq!(code_from_request_line(&line), None);
        assert_eq!(code_from_request_line("GET / HTTP/1.1"), None);
    }

    #[test]
    fn decodes_percent_escaped_code_values() {
        let line = format!("GET {CALLBACK_PATH}?code_autorisation=a%2Bb%20c HTTP/1.1");
        assert_eq!(code_from_request_line(&line).as_deref(), Some("a+b c"));
    }

    /// 端到端跑一次真实监听：无关请求（favicon）应被 404 放过后继续等待，
    /// 带 code 的回调才结束监听。
    #[tokio::test]
    async fn listener_skips_unrelated_requests_and_returns_the_code() {
        let (server, port, _cancel) = spawn_listener(None).await;

        send(port, "/favicon.ico").await;
        send(port, &format!("{CALLBACK_PATH}?code_autorisation=HUukQqWc")).await;

        match server.await.unwrap() {
            CallbackOutcome::Code(code) => assert_eq!(code, "HUukQqWc"),
            CallbackOutcome::Failed(error) => panic!("应拿到授权码，实际失败: {error}"),
        }
    }

    #[tokio::test]
    async fn listener_requires_the_random_callback_path() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let secret_path = format!("{CALLBACK_PATH}/secret");
        let server =
            tokio::spawn(
                async move { wait_for_callback(listener, secret_path, None, cancel_rx).await },
            );

        send(port, &format!("{CALLBACK_PATH}?code_autorisation=evil")).await;
        send(
            port,
            &format!("{CALLBACK_PATH}/secret?code_autorisation=good"),
        )
        .await;
        match server.await.unwrap() {
            CallbackOutcome::Code(code) => assert_eq!(code, "good"),
            CallbackOutcome::Failed(error) => panic!("应拿到正确路径的授权码: {error}"),
        }
        drop(cancel_tx);
    }

    /// 用户在授权页点「拒绝」时，Qobuz 会回带 `error`，监听应立刻结束并报错。
    ///
    /// 关键：拒绝回调**可能不带 state**，因此 error 判断必须排在 state 校验之前，
    /// 否则真实拒绝会退化成「400 后空等到超时」。
    #[tokio::test]
    async fn listener_reports_user_denial_even_without_state() {
        let (server, port, _cancel) = spawn_listener(Some("expected".into())).await;

        send(port, &format!("{CALLBACK_PATH}?error=access_denied")).await;

        match server.await.unwrap() {
            CallbackOutcome::Failed(_) => {}
            CallbackOutcome::Code(code) => panic!("拒绝授权不应拿到授权码: {code}"),
        }
    }

    /// `?noterror=1` 不能被误判成拒绝授权（旧的子串 `contains("error=")` 会踩这个坑）。
    #[tokio::test]
    async fn listener_does_not_treat_lookalike_error_key_as_denial() {
        let (server, port, _cancel) = spawn_listener(None).await;

        send(
            port,
            &format!("{CALLBACK_PATH}?noterror=1&code_autorisation=HUukQqWc"),
        )
        .await;

        match server.await.unwrap() {
            CallbackOutcome::Code(code) => assert_eq!(code, "HUukQqWc"),
            CallbackOutcome::Failed(error) => panic!("不应被判为拒绝授权: {error}"),
        }
    }

    /// 回调带了错误的 state 必须被拒绝；随后正确的 state 仍应被接受。
    #[tokio::test]
    async fn listener_rejects_callback_with_wrong_state() {
        let (server, port, _cancel) = spawn_listener(Some("expected".into())).await;

        send(
            port,
            &format!("{CALLBACK_PATH}?code_autorisation=evil&state=other"),
        )
        .await;
        send(
            port,
            &format!("{CALLBACK_PATH}?code_autorisation=good&state=expected"),
        )
        .await;

        match server.await.unwrap() {
            CallbackOutcome::Code(code) => assert_eq!(code, "good"),
            CallbackOutcome::Failed(error) => panic!("应拿到授权码，实际失败: {error}"),
        }
    }

    /// **回归（曾经的阻断缺陷）**：Qobuz 若不回传 state，回调也必须被接受。
    ///
    /// 旧实现无条件要求回调带 `state=<期望值>`，而 state 从未被放进授权 URL，
    /// 导致真实回跳 100% 被 400 拒绝、空等到 180 秒超时。
    #[tokio::test]
    async fn listener_accepts_callback_without_state() {
        let (server, port, _cancel) = spawn_listener(Some("expected".into())).await;

        send(port, &format!("{CALLBACK_PATH}?code_autorisation=HUukQqWc")).await;

        match server.await.unwrap() {
            CallbackOutcome::Code(code) => assert_eq!(code, "HUukQqWc"),
            CallbackOutcome::Failed(error) => {
                panic!("Qobuz 不回传 state 时也必须接受回调，实际失败: {error}")
            }
        }
    }

    /// 新一轮 start 必须立刻叫停旧监听并释放端口，而不是让旧端口白占 180 秒。
    #[tokio::test]
    async fn listener_stops_immediately_when_cancelled() {
        let (server, _port, cancel) = spawn_listener(None).await;

        cancel.send(()).unwrap();

        match server.await.unwrap() {
            CallbackOutcome::Failed(_) => {}
            CallbackOutcome::Code(code) => panic!("被取消的监听不应拿到授权码: {code}"),
        }
    }

    #[test]
    fn parses_query_keys_exactly() {
        let line = format!("GET {CALLBACK_PATH}?a=1&error=&state=xyz HTTP/1.1");
        let query = parse_query(&line);
        assert_eq!(query.get("a").map(String::as_str), Some("1"));
        assert_eq!(query.get("state").map(String::as_str), Some("xyz"));
        assert!(query.contains_key("error"));
        assert!(!query.contains_key("noterror"));
        // 没有 query 时返回空表而不是 panic。
        assert!(parse_query("GET /qobuz/cb HTTP/1.1").is_empty());
        assert!(parse_query("").is_empty());
    }

    #[test]
    fn reads_token_and_user_id_from_numeric_or_string_fields() {
        let body = json!({ "user_auth_token": "tok123", "user_id": 2961963 });
        assert_eq!(
            first_str_from_value(&body, &["user_auth_token", "token"]).as_deref(),
            Some("tok123")
        );
        assert_eq!(
            first_str_from_value(&body, &["user_id", "userId"]).as_deref(),
            Some("2961963")
        );
        assert_eq!(first_str_from_value(&json!({}), &["token"]), None);
    }

    #[test]
    fn projects_session_with_real_user_id_and_subscription() {
        let user_info = json!({
            "user": {
                "id": 2961963,
                "display_name": "Tester",
                "subscription": { "is_active": true },
                "credential": { "max_format_id": 27 }
            }
        });
        let session = project_session(user_info, "2961963", "tok123");
        assert_eq!(session["user_id"], "2961963");
        assert_eq!(session["user_auth_token"], "tok123");
        assert_eq!(session["display_name"], "Tester");
        assert_eq!(session["is_active"], true);
        assert_eq!(session["max_format_id"], 27);
        assert_eq!(session["user"]["id"], "2961963");
    }

    #[test]
    fn projects_session_with_safe_defaults_when_fields_are_missing() {
        let session = project_session(json!({}), "42", "tok");
        assert_eq!(session["display_name"], "Qobuz User");
        assert_eq!(session["is_active"], false);
        assert_eq!(session["max_format_id"], 5);
    }
}
