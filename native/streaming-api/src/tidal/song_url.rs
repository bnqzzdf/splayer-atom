use std::collections::HashMap;
use std::path::PathBuf;

use base64::Engine;
use serde_json::{json, Value};

use crate::error::StreamingError;
use super::dash::materialize_dash;
use super::TidalClient;

fn tidal_quality_for_level(level: &str) -> &'static [&'static str] {
    match level.to_lowercase().as_str() {
        "hi-res" | "hires" | "hi_res" | "hi_res_lossless" => {
            &["HI_RES_LOSSLESS", "LOSSLESS", "HIGH", "LOW"]
        }
        "lossless" | "flac" => &["LOSSLESS", "HIGH", "LOW"],
        "hq" | "320" | "high" => &["HIGH", "LOW"],
        "sq" | "128" | "lq" | "low" => &["LOW"],
        _ => &["HI_RES_LOSSLESS", "LOSSLESS", "HIGH", "LOW"],
    }
}

fn decode_manifest_text(value: &str) -> Option<String> {
    if value.contains("<MPD") {
        return Some(value.to_string());
    }
    let decoded = base64::engine::general_purpose::STANDARD.decode(value).ok()?;
    String::from_utf8(decoded).ok()
}

impl TidalClient {
    /// 获取 TIDAL 播放源。BTS 返回直链；DASH 在 Rust provider 内 materialize 为临时 fMP4。
    pub async fn track_get_stream_url(
        &self,
        params: &HashMap<String, Value>,
    ) -> Result<Value, StreamingError> {
        let track_id = params
            .get("track_id")
            .or_else(|| params.get("id"))
            .and_then(|v| {
                v.as_str()
                    .map(ToString::to_string)
                    .or_else(|| v.as_u64().map(|n| n.to_string()))
            })
            .unwrap_or_default();

        if track_id.is_empty() {
            return Err(StreamingError::InvalidParam("Missing track_id".into()));
        }

        let level_str = params
            .get("level")
            .or_else(|| params.get("quality"))
            .and_then(Value::as_str)
            .unwrap_or("hi-res");
        let temp_dir = params
            .get("_materialize_dir")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);

        for &quality in tidal_quality_for_level(level_str) {
            let mut req_params = HashMap::new();
            req_params.insert("audioquality".to_string(), quality.to_string());
            req_params.insert("playbackmode".to_string(), "STREAM".to_string());
            req_params.insert("assetpresentation".to_string(), "FULL".to_string());

            let endpoint = format!("tracks/{track_id}/playbackinfopostpaywall");
            let Ok(body) = self.request(&endpoint, req_params, true).await else {
                continue;
            };
            let mime_type = body
                .get("manifestMimeType")
                .and_then(Value::as_str)
                .unwrap_or("");
            let manifest = body.get("manifest").and_then(Value::as_str).unwrap_or("");
            let bit_depth = body.get("bitDepth").and_then(Value::as_i64);
            let sample_rate = body.get("sampleRate").and_then(Value::as_f64);
            let sound_quality = body
                .get("audioQuality")
                .and_then(Value::as_str)
                .unwrap_or(quality);

            if mime_type.eq_ignore_ascii_case("application/vnd.tidal.bts") && !manifest.is_empty() {
                if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(manifest) {
                    if let Ok(manifest_json) = serde_json::from_slice::<Value>(&decoded) {
                        if let Some(first_url) = manifest_json
                            .get("urls")
                            .and_then(Value::as_array)
                            .and_then(|urls| urls.first())
                            .and_then(Value::as_str)
                            .filter(|url| !url.is_empty())
                        {
                            let codec = manifest_json
                                .get("codecs")
                                .and_then(Value::as_str)
                                .unwrap_or("flac");
                            return Ok(json!({
                                "code": 200,
                                "data": {
                                    "url": first_url,
                                    "audioQuality": sound_quality,
                                    "codec": codec,
                                    "bitDepth": bit_depth,
                                    "sampleRate": sample_rate,
                                },
                                "raw": body
                            }));
                        }
                    }
                }
            }

            if mime_type.to_ascii_lowercase().contains("dash+xml") && !manifest.is_empty() {
                if let Some(xml) = decode_manifest_text(manifest) {
                    let key = format!("{track_id}-{quality}");
                    if let Ok((path, descriptor)) =
                        materialize_dash(&self.http, &xml, &temp_dir, &key).await
                    {
                        return Ok(json!({
                            "code": 200,
                            "data": {
                                "localPath": path.to_string_lossy(),
                                "audioQuality": sound_quality,
                                "codec": descriptor.codec,
                                "bitDepth": bit_depth,
                                "sampleRate": descriptor.sample_rate.map(f64::from).or(sample_rate),
                            },
                            "raw": body
                        }));
                    }
                }
            }

            if let Some(direct_url) = body
                .get("url")
                .and_then(Value::as_str)
                .filter(|url| !url.is_empty())
            {
                return Ok(json!({
                    "code": 200,
                    "data": {
                        "url": direct_url,
                        "audioQuality": sound_quality,
                        "bitDepth": bit_depth,
                        "sampleRate": sample_rate,
                    },
                    "raw": body
                }));
            }
        }

        Err(StreamingError::Api {
            status: 403,
            message: "Unable to obtain stream URL from TIDAL, track may be unavailable or subscription expired".into(),
        })
    }
}
