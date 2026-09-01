use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use regex::Regex;
use tokio::sync::RwLock;

use super::config::{CREDS_CACHE_TTL_SECS, QOBUZ_FIREFOX_UA, QOBUZ_WEB_BASE};
use crate::error::StreamingError;

/// atom-base 已验证可工作的 production app id / initialization 值。
pub const PROD_APP_ID: &str = "798273057";
pub const PROD_INIT: &str = "abb21364945c0583309667d13ca3d93a";

#[derive(Debug, Clone)]
pub struct QobuzCredentials {
    pub app_id: String,
    pub secret: String,
    pub secrets: Vec<String>,
    pub saved_at: u64,
}

static WORKING_SECRET: RwLock<Option<String>> = RwLock::const_new(None);
static MEM_CREDS: RwLock<Option<QobuzCredentials>> = RwLock::const_new(None);

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn bundle_path_from_html(html: &str) -> Result<&str, StreamingError> {
    let bundle_re = Regex::new(r#"src="(/resources/[^"]*bundle[^"]*\.js)""#)
        .map_err(|error| StreamingError::Parse(error.to_string()))?;
    bundle_re
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str())
        .ok_or_else(|| StreamingError::Parse("bundle.js not found in Qobuz login page".into()))
}

fn credentials_from_bundle(js: &str) -> Result<QobuzCredentials, StreamingError> {
    let app_id_re = Regex::new(r#"appId:"(\d{9})""#)
        .map_err(|error| StreamingError::Parse(error.to_string()))?;
    let matched_app_ids: Vec<String> = app_id_re
        .captures_iter(&js)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().to_owned()))
        .collect();
    let app_id = matched_app_ids
        .iter()
        .find(|value| value.as_str() == PROD_APP_ID)
        .cloned()
        .or_else(|| matched_app_ids.first().cloned())
        .unwrap_or_else(|| PROD_APP_ID.to_owned());

    let seed_re = Regex::new(r#"[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)"#)
        .map_err(|error| StreamingError::Parse(error.to_string()))?;
    let mut seeds: Vec<(String, String)> = Vec::new();
    for capture in seed_re.captures_iter(&js) {
        if let (Some(seed), Some(timezone)) = (capture.get(1), capture.get(2)) {
            let timezone = timezone.as_str().to_owned();
            if !seeds.iter().any(|(value, _)| value == &timezone) {
                seeds.push((timezone, seed.as_str().to_owned()));
            }
        }
    }

    let timezones: Vec<String> = seeds
        .iter()
        .filter_map(|(timezone, _)| {
            let mut chars = timezone.chars();
            chars.next().map(|first| {
                format!("{}{}", first.to_uppercase(), chars.collect::<String>())
            })
        })
        .collect();

    let mut combined: HashMap<String, String> = HashMap::new();
    if !timezones.is_empty() {
        let pattern = format!(
            r#"name:"\w+/({})",info:"([\w=]+)",extras:"([\w=]+)""#,
            timezones.join("|")
        );
        let info_re = Regex::new(&pattern)
            .map_err(|error| StreamingError::Parse(error.to_string()))?;
        for capture in info_re.captures_iter(&js) {
            if let (Some(timezone), Some(info), Some(extras)) =
                (capture.get(1), capture.get(2), capture.get(3))
            {
                let timezone = timezone.as_str().to_lowercase();
                if let Some((_, seed)) = seeds.iter().find(|(value, _)| value == &timezone) {
                    combined.entry(timezone).or_insert_with(|| {
                        format!("{seed}{}{}", info.as_str(), extras.as_str())
                    });
                }
            }
        }
    }

    let mut secrets = Vec::new();
    for (timezone, _) in &seeds {
        let Some(encoded) = combined.get(timezone) else {
            continue;
        };
        if encoded.len() <= 44 {
            continue;
        }
        let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(&encoded[..encoded.len() - 44]) else {
            continue;
        };
        let Ok(secret) = String::from_utf8(decoded) else {
            continue;
        };
        if !secret.is_empty() && !secrets.contains(&secret) {
            secrets.push(secret);
        }
    }

    if let Some(index) = secrets.iter().position(|secret| secret == PROD_INIT) {
        let production = secrets.remove(index);
        secrets.insert(0, production);
    } else {
        secrets.insert(0, PROD_INIT.to_owned());
    }

    Ok(QobuzCredentials {
        app_id,
        secret: secrets[0].clone(),
        secrets,
        saved_at: now_secs(),
    })
}

async fn fetch_dynamic_credentials(
    client: &reqwest::Client,
) -> Result<QobuzCredentials, StreamingError> {
    let login_url = format!("{QOBUZ_WEB_BASE}/login");
    let html = client
        .get(&login_url)
        .header("User-Agent", QOBUZ_FIREFOX_UA)
        .send()
        .await?
        .text()
        .await?;
    let bundle_url = format!("{QOBUZ_WEB_BASE}{}", bundle_path_from_html(&html)?);
    let js = client
        .get(&bundle_url)
        .header("User-Agent", QOBUZ_FIREFOX_UA)
        .send()
        .await?
        .text()
        .await?;
    credentials_from_bundle(&js)
}

/// 获取当前 Qobuz 应用凭据。
///
/// 显式环境变量优先；自动发现结果只保存在当前进程内，不读取第三方配置，也不写入磁盘。
pub async fn get_credentials(
    client: &reqwest::Client,
    force_refresh: bool,
) -> Result<QobuzCredentials, StreamingError> {
    if force_refresh {
        *MEM_CREDS.write().await = None;
        *WORKING_SECRET.write().await = None;
    }

    if let (Ok(app_id), Ok(secret)) = (
        std::env::var("QOBUZ_APP_ID"),
        std::env::var("QOBUZ_APP_SECRET"),
    ) {
        if !app_id.trim().is_empty() && !secret.trim().is_empty() {
            return Ok(QobuzCredentials {
                app_id,
                secret: secret.clone(),
                secrets: vec![secret],
                saved_at: now_secs(),
            });
        }
    }

    if let Some(cached) = MEM_CREDS.read().await.as_ref() {
        if now_secs().saturating_sub(cached.saved_at) < CREDS_CACHE_TTL_SECS {
            return Ok(cached.clone());
        }
    }

    let credentials = fetch_dynamic_credentials(client).await.unwrap_or_else(|_| QobuzCredentials {
        app_id: PROD_APP_ID.to_owned(),
        secret: PROD_INIT.to_owned(),
        secrets: vec![PROD_INIT.to_owned()],
        saved_at: now_secs(),
    });
    *MEM_CREDS.write().await = Some(credentials.clone());
    Ok(credentials)
}

pub async fn get_working_secret() -> Option<String> {
    WORKING_SECRET.read().await.clone()
}

pub async fn set_working_secret(secret: String) {
    *WORKING_SECRET.write().await = Some(secret);
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    use super::{bundle_path_from_html, credentials_from_bundle, PROD_APP_ID, PROD_INIT};

    #[test]
    fn verified_fallback_credentials_are_non_empty() {
        assert!(!PROD_APP_ID.is_empty());
        assert!(!PROD_INIT.is_empty());
    }

    #[test]
    fn discovers_versioned_web_player_bundle_without_fixed_version() {
        let html = r#"<html><script src="/resources/8.2.0-b034/bundle.js"></script></html>"#;
        assert_eq!(
            bundle_path_from_html(html).unwrap(),
            "/resources/8.2.0-b034/bundle.js"
        );
    }

    #[test]
    fn derives_secret_candidate_from_seed_timezone_bundle_data() {
        let derived_secret = "0123456789abcdef0123456789abcdef";
        let encoded = base64::engine::general_purpose::STANDARD.encode(derived_secret);
        let combined = format!("{encoded}{}", "A".repeat(44));
        let seed = &combined[..20];
        let info = &combined[20..40];
        let extras = &combined[40..];
        let bundle = format!(
            "x.initialSeed(\"{seed}\",window.utimezone.berlin);name:\"zone/Berlin\",info:\"{info}\",extras:\"{extras}\";appId:\"123456789\""
        );
        let credentials = credentials_from_bundle(&bundle).unwrap();
        assert_eq!(credentials.app_id, "123456789");
        assert!(credentials.secrets.iter().any(|value| value == derived_secret));
    }
}
