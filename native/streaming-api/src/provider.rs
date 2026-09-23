use std::collections::HashMap;

use serde_json::Value;

use crate::{QobuzClient, StreamingError, TidalClient};

fn object_map(value: Value, name: &str) -> Result<HashMap<String, Value>, StreamingError> {
    match value {
        Value::Object(map) => Ok(map.into_iter().collect()),
        Value::Null => Ok(HashMap::new()),
        _ => Err(StreamingError::InvalidParam(format!(
            "{name} must be an object",
        ))),
    }
}

fn auth_string(auth: &HashMap<String, Value>, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| auth.get(*name).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

async fn call_qobuz(
    action: &str,
    auth: HashMap<String, Value>,
    params: HashMap<String, Value>,
) -> Result<Value, StreamingError> {
    let client = QobuzClient::new(
        auth_string(&auth, &["userAuthToken", "user_auth_token", "token"]),
        auth_string(&auth, &["userId", "user_id"]),
    );

    match action {
        "auth_login" | "login" => client.auth_login(&params).await,
        // 一键 OAuth：起本地回调监听 → 等浏览器回跳 → 兑换 token。
        "auth_oauth_start" | "oauth_start" => client.auth_oauth_start(&params).await,
        "auth_oauth_await" | "oauth_await" => client.auth_oauth_await(&params).await,
        "auth_status" | "status" | "user_detail" => client.auth_status().await,
        "auth_logout" | "logout" => client.auth_logout().await,
        "catalog_search" | "search" => client.catalog_search(&params).await,
        "track_getFileUrl" | "song_url" => client.track_get_file_url(&params).await,
        "album_get" | "album" => client.album_get(&params).await,
        "artist_get" | "artist" => client.artist_get(&params).await,
        "artist_getReleasesList" => client.artist_get_releases_list(&params).await,
        "playlist_get" | "playlist" => client.playlist_get(&params).await,
        "user_getFavorites" | "favorites" => client.user_get_favorites(&params).await,
        "favorite_create" => client.favorite_create(&params).await,
        "favorite_delete" => client.favorite_delete(&params).await,
        // 首页（发现页）与分类导航
        "discover_index" | "home" => client.discover_index(&params).await,
        "discover_section" => client.discover_section(&params).await,
        "genre_list" | "genres" => client.genre_list(&params).await,
        _ => Err(StreamingError::InvalidParam(format!(
            "Unsupported Qobuz API: {action}",
        ))),
    }
}

/// 一次 provider 调用及其可能产生的认证更新。
pub struct ProviderCallResult {
    pub value: Value,
    pub refreshed_tokens: Option<(String, Option<String>, Option<u64>)>,
}

async fn call_provider_with_refresh(
    platform: &str,
    action: &str,
    auth: Value,
    params: Value,
) -> Result<ProviderCallResult, StreamingError> {
    let auth = object_map(auth, "auth")?;
    let params = object_map(params, "params")?;

    match platform {
        "qobuz" => Ok(ProviderCallResult {
            value: call_qobuz(action, auth, params).await?,
            refreshed_tokens: None,
        }),
        "tidal" => {
            let client = TidalClient::new(
                auth_string(&auth, &["accessToken", "access_token"]),
                auth_string(&auth, &["refreshToken", "refresh_token"]),
                auth_string(&auth, &["userId", "user_id"]),
                auth_string(&auth, &["countryCode", "country_code"]),
                auth_string(&auth, &["clientId", "client_id"]),
                auth_string(&auth, &["clientSecret", "client_secret"]),
            );
            let value = match call_tidal_with_client(&client, action, params).await {
                Ok(value) => value,
                Err(source) => {
                    if let Some((access_token, refresh_token, expires_at)) =
                        client.take_refreshed_tokens()
                    {
                        return Err(StreamingError::WithRefreshedAuth {
                            source: Box::new(source),
                            access_token,
                            refresh_token,
                            expires_at,
                        });
                    }
                    return Err(source);
                }
            };
            Ok(ProviderCallResult {
                value,
                refreshed_tokens: client.take_refreshed_tokens(),
            })
        }
        _ => Err(StreamingError::InvalidParam(format!(
            "Unsupported streaming provider: {platform}",
        ))),
    }
}

async fn call_tidal_with_client(
    client: &TidalClient,
    action: &str,
    params: HashMap<String, Value>,
) -> Result<Value, StreamingError> {
    match action {
        "auth_authorize" | "authorize" => client.auth_authorize(&params).await,
        "auth_exchange" | "exchange" => client.auth_exchange(&params).await,
        "auth_device_authorization" | "device_authorization" => {
            client.auth_device_authorization(&params).await
        }
        "auth_token_poll" | "token_poll" => client.auth_token_poll(&params).await,
        "auth_token_refresh" | "refresh_token" => client.auth_token_refresh(&params).await,
        "auth_status" | "status" | "user_detail" => client.auth_status().await,
        "auth_logout" | "logout" => client.auth_logout().await,
        "search" => client.search(&params).await,
        "track_getStreamUrl" | "song_url" => client.track_get_stream_url(&params).await,
        "album_get" | "album" => client.album_get(&params).await,
        "album_getTracks" => client.album_get_tracks(&params).await,
        "artist_get" | "artist" => client.artist_get(&params).await,
        "artist_getAlbums" => client.artist_get_albums(&params).await,
        "artist_getTopTracks" => client.artist_get_top_tracks(&params).await,
        "playlist_get" | "playlist" => client.playlist_get(&params).await,
        "playlist_getTracks" => client.playlist_get_tracks(&params).await,
        "user_getFavorites" | "favorites" => client.user_get_favorites(&params).await,
        // 首页（pages）与分类导航
        "pages_home" | "home" => client.pages_home(&params).await,
        "pages_get" => client.pages_get(&params).await,
        "genres" | "genre_list" => client.genres(&params).await,
        _ => Err(StreamingError::InvalidParam(format!(
            "Unsupported TIDAL API: {action}",
        ))),
    }
}

/// 调用 Atom 正式维护的流媒体协议实现。
///
/// 登录态与持久化由 Node Core 持有；这里仅根据本次调用传入的认证上下文执行平台协议。
pub async fn call_provider(
    platform: &str,
    action: &str,
    auth: Value,
    params: Value,
) -> Result<Value, StreamingError> {
    Ok(call_provider_with_refresh(platform, action, auth, params)
        .await?
        .value)
}

pub async fn call_provider_with_refresh_result(
    platform: &str,
    action: &str,
    auth: Value,
    params: Value,
) -> Result<ProviderCallResult, StreamingError> {
    call_provider_with_refresh(platform, action, auth, params).await
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::call_provider;

    #[tokio::test]
    async fn rejects_non_streaming_platforms() {
        let error = call_provider("netease", "search", json!({}), json!({}))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Unsupported streaming provider"));
    }

    #[tokio::test]
    async fn rejects_unknown_actions_before_network_io() {
        let error = call_provider("qobuz", "not_real", json!({}), json!({}))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Unsupported Qobuz API"));
    }
}
