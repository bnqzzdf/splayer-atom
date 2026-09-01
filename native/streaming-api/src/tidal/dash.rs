use std::path::{Path, PathBuf};

use regex::Regex;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::StreamingError;
use super::config::TIDAL_USER_AGENT;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TidalDashDescriptor {
    pub initialization_url: String,
    pub media_urls: Vec<String>,
    pub codec: Option<String>,
    pub sample_rate: Option<u32>,
}

fn parse_attr(attrs: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"\b{}\s*=\s*[\"']([^\"']+)[\"']"#, regex::escape(name));
    Regex::new(&pattern)
        .ok()?
        .captures(attrs)
        .and_then(|caps| caps.get(1))
        .map(|value| value.as_str().replace("&amp;", "&"))
}

fn require_http_url(value: String, field: &str) -> Result<String, StreamingError> {
    if value.starts_with("https://") || value.starts_with("http://") {
        Ok(value)
    } else {
        Err(StreamingError::Parse(format!(
            "TIDAL DASH {field} 不是绝对 HTTP URL"
        )))
    }
}

fn replace_representation_id(
    template: &str,
    representation_id: Option<&str>,
) -> Result<String, StreamingError> {
    if !template.contains("$RepresentationID$") {
        return Ok(template.to_string());
    }
    let representation_id = representation_id.ok_or_else(|| {
        StreamingError::Parse("TIDAL DASH 缺少 Representation ID".into())
    })?;
    Ok(template.replace("$RepresentationID$", representation_id))
}

fn replace_segment_number(template: &str, number: u64) -> Result<String, StreamingError> {
    if template.contains("$Time$") {
        return Err(StreamingError::Parse(
            "TIDAL DASH 暂不支持 $Time$ SegmentTemplate".into(),
        ));
    }
    let number_re = Regex::new(r"\$Number(?:%0(\d+)d)?\$")
        .map_err(|error| StreamingError::Parse(error.to_string()))?;
    if !number_re.is_match(template) {
        return Err(StreamingError::Parse(
            "TIDAL DASH media 模板缺少 $Number$".into(),
        ));
    }
    Ok(number_re
        .replace_all(template, |caps: &regex::Captures<'_>| {
            caps.get(1)
                .and_then(|width| width.as_str().parse::<usize>().ok())
                .map(|width| format!("{number:0width$}"))
                .unwrap_or_else(|| number.to_string())
        })
        .into_owned())
}

pub fn parse_dash_manifest(xml: &str) -> Result<TidalDashDescriptor, StreamingError> {
    if !xml.contains("<MPD") {
        return Err(StreamingError::Parse(
            "TIDAL DASH manifest 不是 MPD XML".into(),
        ));
    }

    let representation_re = Regex::new(r"(?s)<Representation\b([^>]*)>(.*?)</Representation>")
        .map_err(|error| StreamingError::Parse(error.to_string()))?;
    let template_re = Regex::new(r"(?s)<SegmentTemplate\b([^>]*)>(.*?)</SegmentTemplate>")
        .map_err(|error| StreamingError::Parse(error.to_string()))?;
    let segment_re = Regex::new(r"(?s)<S\b([^>]*)/?>")
        .map_err(|error| StreamingError::Parse(error.to_string()))?;

    for representation in representation_re.captures_iter(xml) {
        let representation_attrs = representation.get(1).map(|value| value.as_str()).unwrap_or("");
        let representation_body = representation.get(2).map(|value| value.as_str()).unwrap_or("");
        let Some(template) = template_re.captures(representation_body) else {
            continue;
        };
        let template_attrs = template.get(1).map(|value| value.as_str()).unwrap_or("");
        let template_body = template.get(2).map(|value| value.as_str()).unwrap_or("");

        let Some(raw_initialization) = parse_attr(template_attrs, "initialization") else {
            continue;
        };
        let Some(raw_media) = parse_attr(template_attrs, "media") else {
            continue;
        };
        let representation_id = parse_attr(representation_attrs, "id");
        let initialization_url = require_http_url(
            replace_representation_id(&raw_initialization, representation_id.as_deref())?,
            "initialization",
        )?;
        let media_template =
            replace_representation_id(&raw_media, representation_id.as_deref())?;
        let start_number = parse_attr(template_attrs, "startNumber")
            .as_deref()
            .unwrap_or("1")
            .parse::<u64>()
            .map_err(|_| StreamingError::Parse("TIDAL DASH startNumber 数值无效".into()))?;

        let mut segment_count = 0usize;
        for segment in segment_re.captures_iter(template_body) {
            let attrs = segment.get(1).map(|value| value.as_str()).unwrap_or("");
            let repeat = parse_attr(attrs, "r")
                .as_deref()
                .unwrap_or("0")
                .parse::<i64>()
                .map_err(|_| StreamingError::Parse("TIDAL DASH r 数值无效".into()))?;
            if repeat < 0 {
                return Err(StreamingError::Parse("TIDAL DASH r 数值无效".into()));
            }
            segment_count = segment_count
                .checked_add(repeat as usize + 1)
                .ok_or_else(|| StreamingError::Parse("TIDAL DASH 分段数量溢出".into()))?;
            if segment_count > 10_000 {
                return Err(StreamingError::Parse("TIDAL DASH 分段数量异常".into()));
            }
        }
        if segment_count == 0 {
            return Err(StreamingError::Parse(
                "TIDAL DASH 缺少 SegmentTimeline".into(),
            ));
        }

        let mut media_urls = Vec::with_capacity(segment_count);
        for index in 0..segment_count {
            let number = start_number + index as u64;
            media_urls.push(require_http_url(
                replace_segment_number(&media_template, number)?,
                "media",
            )?);
        }

        return Ok(TidalDashDescriptor {
            initialization_url,
            media_urls,
            codec: parse_attr(representation_attrs, "codecs"),
            sample_rate: parse_attr(representation_attrs, "audioSamplingRate")
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|value| *value > 0),
        });
    }

    Err(StreamingError::Parse(
        "TIDAL DASH 未找到可用的 audio Representation/SegmentTemplate".into(),
    ))
}

fn safe_key(value: &str) -> String {
    let value: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .take(160)
        .collect();
    if value.is_empty() {
        "track".into()
    } else {
        value
    }
}

async fn valid_mp4_header(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path).await else {
        return false;
    };
    let mut header = [0_u8; 8];
    if file.read_exact(&mut header).await.is_err() {
        return false;
    }
    matches!(&header[4..8], b"ftyp" | b"styp")
}

pub async fn materialize_dash(
    client: &reqwest::Client,
    xml: &str,
    temp_dir: &Path,
    key: &str,
) -> Result<(PathBuf, TidalDashDescriptor), StreamingError> {
    let descriptor = parse_dash_manifest(xml)?;
    let root = temp_dir
        .join("splayer-atom-tidal-dash")
        .join(std::process::id().to_string());
    fs::create_dir_all(&root)
        .await
        .map_err(|error| StreamingError::Other(format!("创建 TIDAL DASH 临时目录失败: {error}")))?;

    let final_path = root.join(format!("{}.mp4", safe_key(key)));
    if valid_mp4_header(&final_path).await {
        return Ok((final_path, descriptor));
    }

    let part_path = final_path.with_extension("mp4.part");
    let _ = fs::remove_file(&part_path).await;
    let mut output = fs::File::create(&part_path)
        .await
        .map_err(|error| StreamingError::Other(format!("创建 TIDAL DASH 临时文件失败: {error}")))?;

    let download = async {
        for url in std::iter::once(&descriptor.initialization_url).chain(descriptor.media_urls.iter()) {
            let response = client
                .get(url)
                .header("Accept", "*/*")
                .header("Accept-Encoding", "identity")
                .header("User-Agent", TIDAL_USER_AGENT)
                .send()
                .await?;
            let status = response.status();
            if !status.is_success() {
                return Err(StreamingError::Api {
                    status: status.as_u16(),
                    message: "TIDAL DASH 分段下载失败".into(),
                });
            }
            let bytes = response.bytes().await?;
            if bytes.is_empty() {
                return Err(StreamingError::Parse("TIDAL DASH 分段为空".into()));
            }
            output
                .write_all(&bytes)
                .await
                .map_err(|error| StreamingError::Other(format!("写入 TIDAL DASH 分段失败: {error}")))?;
        }
        output
            .flush()
            .await
            .map_err(|error| StreamingError::Other(format!("刷新 TIDAL DASH 临时文件失败: {error}")))?;
        Ok::<(), StreamingError>(())
    }
    .await;

    if let Err(error) = download {
        drop(output);
        let _ = fs::remove_file(&part_path).await;
        return Err(error);
    }
    drop(output);

    if !valid_mp4_header(&part_path).await {
        let _ = fs::remove_file(&part_path).await;
        return Err(StreamingError::Parse(
            "TIDAL DASH materialization 不是 MP4/ISOBMFF".into(),
        ));
    }
    let _ = fs::remove_file(&final_path).await;
    fs::rename(&part_path, &final_path)
        .await
        .map_err(|error| StreamingError::Other(format!("提交 TIDAL DASH 临时文件失败: {error}")))?;
    Ok((final_path, descriptor))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mpd(media: &str, repeat: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="FLAC_HIRES,96000,24" codecs="flac" audioSamplingRate="96000">
        <SegmentTemplate initialization="https://audio.invalid/init.mp4?token=x&amp;a=1" media="{media}" startNumber="7">
          <SegmentTimeline>
            <S d="380928" r="{repeat}" />
            <S d="128210" />
          </SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#
        )
    }

    #[test]
    fn parses_number_based_dash_manifest() {
        let parsed = parse_dash_manifest(&mpd(
            "https://audio.invalid/$Number$.mp4?token=x&amp;a=1",
            "2",
        ))
        .unwrap();
        assert_eq!(
            parsed.initialization_url,
            "https://audio.invalid/init.mp4?token=x&a=1"
        );
        assert_eq!(parsed.codec.as_deref(), Some("flac"));
        assert_eq!(parsed.sample_rate, Some(96_000));
        assert_eq!(
            parsed.media_urls,
            vec![
                "https://audio.invalid/7.mp4?token=x&a=1",
                "https://audio.invalid/8.mp4?token=x&a=1",
                "https://audio.invalid/9.mp4?token=x&a=1",
                "https://audio.invalid/10.mp4?token=x&a=1",
            ]
        );
    }

    #[test]
    fn supports_zero_padded_number_templates() {
        let parsed = parse_dash_manifest(&mpd(
            "https://audio.invalid/segment-$Number%05d$.mp4",
            "0",
        ))
        .unwrap();
        assert_eq!(
            parsed.media_urls,
            vec![
                "https://audio.invalid/segment-00007.mp4",
                "https://audio.invalid/segment-00008.mp4",
            ]
        );
    }

    #[test]
    fn rejects_time_and_unbounded_templates() {
        assert!(parse_dash_manifest(&mpd("https://audio.invalid/$Time$.mp4", "0"))
            .unwrap_err()
            .to_string()
            .contains("$Time$"));
        assert!(parse_dash_manifest(&mpd("https://audio.invalid/$Number$.mp4", "-1"))
            .unwrap_err()
            .to_string()
            .contains("数值无效"));
    }
}
