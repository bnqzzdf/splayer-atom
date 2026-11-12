use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::str;

use encoding_rs::GBK;
use ffmpeg_audio::SourceAudioInfo;

mod cover;
mod editor;
mod folder_cover;
mod lyrics;
mod tag_fields;

pub use cover::{
    cover_thumb_path, extract_cover_thumbnail, extract_directory_cover_thumbnail,
    find_directory_cover, make_thumbnail_jpeg, read_attached_pic,
};
pub(crate) use cover::{
    directory_cover_thumb_path, extract_cover_thumbnail_with_fallback, is_directory_cover_thumbnail,
};
pub use editor::{read_tags, write_tags, TagWriteRequest};
pub use lyrics::{extract_embedded_lyric, find_all_external_lyrics, ExternalLyric};

/// 音频元数据（包含封面路径和歌词）
#[derive(Clone, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 注释/副标题
    pub comment: Option<String>,
    pub duration_secs: f64,
    /// 播放采样率（重采样后，用于音频输出）
    pub sample_rate: u32,
    /// 音源原始声道数
    pub channels: u16,
    /// 原始采样率（解码前，用于前端显示）
    pub original_sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式名称（如 "flac", "mp3", "aac"）
    pub codec: String,
    /// 内嵌歌词
    pub embedded_lyric: Option<String>,
    /// 同目录所有歌词文件
    pub external_lyrics: Vec<ExternalLyric>,
    /// 封面缩略图缓存路径（用于前端日常显示）
    pub cover: Option<String>,
    /// 原始封面数据（load 时一次性提取，供 SMTC 等使用，避免重复打开文件）
    pub cover_raw: Option<Vec<u8>>,
}

/// 音频流基本参数（scanner 和 decoder 共用）
pub struct StreamInfo {
    pub bit_rate: i64,
    pub sample_rate: u32,
    pub bits_per_sample: u32,
    pub channels: u32,
}

/// 容器级别的 tag 信息
#[derive(Clone, Default)]
pub struct Tags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub track: Option<u16>,
    pub disc: Option<u16>,
    pub comment: Option<String>,
}

/// 把 ffmpeg_audio 的 SourceAudioInfo 转成内部 StreamInfo
pub fn extract_stream_info(info: &SourceAudioInfo) -> StreamInfo {
    StreamInfo {
        bit_rate: info.bit_rate,
        sample_rate: info.sample_rate.max(0) as u32,
        bits_per_sample: info.bits_per_sample.max(0) as u32,
        channels: info.channels.max(0) as u32,
    }
}

/// 从容器 metadata 提取常见 tag
pub fn extract_tags(dict: &HashMap<String, String>) -> Tags {
    let title = dict_get(dict, "title").map(ToString::to_string);
    let album_artist = dict_get(dict, "album_artist")
        .or_else(|| dict_get(dict, "albumartist"))
        .map(ToString::to_string);
    let artist = dict_get(dict, "artist")
        .map(ToString::to_string)
        .or_else(|| album_artist.clone());
    let album = dict_get(dict, "album").map(ToString::to_string);
    let parse_year = |raw: &str| {
        let raw = raw.trim();
        raw.get(..4)
            .or(Some(raw))
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|year| *year > 0)
    };
    let year = dict_get(dict, "year")
        .and_then(parse_year)
        .or_else(|| dict_get(dict, "date").and_then(parse_year));
    let parse_index = |raw: &str| {
        raw.trim()
            .split(['/', '\\'])
            .next()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .filter(|value| *value > 0)
    };
    let track = dict_get(dict, "track")
        .or_else(|| dict_get(dict, "tracknumber"))
        .and_then(parse_index);
    let disc = dict_get(dict, "disc")
        .or_else(|| dict_get(dict, "discnumber"))
        .or_else(|| dict_get(dict, "disk"))
        .and_then(parse_index);
    let comment = dict_get(dict, "comment").map(ToString::to_string);
    Tags {
        title,
        artist,
        album_artist,
        album,
        year,
        track,
        disc,
        comment,
    }
}

/// 修复少量旧中文下载器写出的损坏 ID3 文本。
///
/// 这类文件把 GBK 原始字节逐字节扩成 Latin-1/UTF-16 码点，例如 `ÇôÄñ` 实际应为 `囚鸟`。
/// 为避免误伤正常西文标签，仅当修复后的标题与真实文件名完全一致时，才修复同一文件的标题/歌手/专辑。
pub fn repair_legacy_gbk_tags_for_path(mut tags: Tags, path: &str) -> Tags {
    let Some(file_stem) = Path::new(path).file_stem().and_then(|value| value.to_str()) else {
        return tags;
    };
    let Some(raw_title) = tags.title.as_deref() else {
        return tags;
    };
    let Some(repaired_title) = decode_latin1_as_gbk(raw_title) else {
        return tags;
    };
    if repaired_title != file_stem {
        return tags;
    }

    tags.title = Some(repaired_title);
    tags.artist = tags
        .artist
        .take()
        .map(|value| decode_latin1_as_gbk(&value).unwrap_or(value));
    tags.album = tags
        .album
        .take()
        .map(|value| decode_latin1_as_gbk(&value).unwrap_or(value));
    tags
}

fn decode_latin1_as_gbk(text: &str) -> Option<String> {
    let bytes = text
        .chars()
        .map(|ch| u8::try_from(u32::from(ch)).ok())
        .collect::<Option<Vec<_>>>()?;
    if bytes.iter().filter(|&&byte| byte >= 0x80).count() < 2 {
        return None;
    }
    let (decoded, _, had_errors) = GBK.decode(&bytes);
    if had_errors {
        return None;
    }
    let decoded = decoded.trim_matches('\0').trim().to_string();
    (!decoded.is_empty() && decoded != text).then_some(decoded)
}

/// WAV 同时可能带 ID3v2 与 RIFF INFO。FFmpeg 会把两套标签合并成普通字符串，
/// 遇到 GBK INFO 时做 UTF-8 lossy 解码并覆盖正确的 ID3 值；这里在 WAV 上优先
/// 读 ID3v2，缺失字段再用 RIFF INFO 的原始字节按 UTF-8/GBK 解码补齐。
pub fn extract_tags_for_path(dict: &HashMap<String, String>, path: &str) -> Tags {
    let fallback = repair_legacy_gbk_tags_for_path(extract_tags(dict), path);
    if !is_wav_path(path) || !tags_need_repair(&fallback) {
        return fallback;
    }
    read_wav_tags(path)
        .map(|tags| merge_tags(tags, Some(fallback.clone())))
        .unwrap_or(fallback)
}

fn is_wav_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
}

fn tags_need_repair(tags: &Tags) -> bool {
    [
        tags.title.as_deref(),
        tags.artist.as_deref(),
        tags.album_artist.as_deref(),
        tags.album.as_deref(),
        tags.comment.as_deref(),
    ]
    .iter()
    .any(|value| value.is_some_and(|text| text.contains('\u{FFFD}')))
}

fn read_wav_tags(path: &str) -> Option<Tags> {
    let id3 = editor::read_tags(path).ok().map(|tags| Tags {
        title: tags.title,
        artist: tags.artist,
        album_artist: tags.album_artist,
        album: tags.album,
        year: tags.year,
        track: tags
            .track_number
            .and_then(|value| u16::try_from(value).ok()),
        disc: tags.disc_number.and_then(|value| u16::try_from(value).ok()),
        comment: None,
    });
    let info = read_wav_info_tags(path);
    let merged = merge_tags(id3.unwrap_or_default(), info);
    (merged.title.is_some()
        || merged.artist.is_some()
        || merged.album.is_some()
        || merged.album_artist.is_some())
    .then_some(merged)
}

fn merge_tags(primary: Tags, fallback: Option<Tags>) -> Tags {
    let fallback = fallback.unwrap_or_default();
    Tags {
        title: usable_text(primary.title).or_else(|| usable_text(fallback.title)),
        artist: usable_text(primary.artist).or_else(|| usable_text(fallback.artist)),
        album_artist: usable_text(primary.album_artist)
            .or_else(|| usable_text(fallback.album_artist)),
        album: usable_text(primary.album).or_else(|| usable_text(fallback.album)),
        year: primary.year.or(fallback.year),
        track: primary.track.or(fallback.track),
        disc: primary.disc.or(fallback.disc),
        comment: usable_text(primary.comment).or_else(|| usable_text(fallback.comment)),
    }
}

fn usable_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty() && !text.contains('\u{FFFD}'))
}

fn read_wav_info_tags(path: &str) -> Option<Tags> {
    let mut file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len();
    let mut header = [0_u8; 12];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return None;
    }

    let mut tags = Tags::default();
    let mut position = 12_u64;
    while position + 8 <= file_len {
        file.seek(SeekFrom::Start(position)).ok()?;
        let mut chunk = [0_u8; 8];
        file.read_exact(&mut chunk).ok()?;
        let id = &chunk[0..4];
        let size = u32::from_le_bytes(chunk[4..8].try_into().ok()?) as u64;
        let data_start = position + 8;
        if size > file_len.saturating_sub(data_start) {
            break;
        }
        if id == b"LIST" && size >= 4 {
            file.seek(SeekFrom::Start(data_start)).ok()?;
            let mut list_type = [0_u8; 4];
            file.read_exact(&mut list_type).ok()?;
            if &list_type == b"INFO" {
                read_wav_info_items(&mut file, data_start + 4, data_start + size, &mut tags);
            }
        }
        position = data_start + size + (size & 1);
    }

    (tags.title.is_some()
        || tags.artist.is_some()
        || tags.album.is_some()
        || tags.year.is_some()
        || tags.track.is_some())
    .then_some(tags)
}

fn read_wav_info_items(file: &mut File, start: u64, end: u64, tags: &mut Tags) {
    let mut position = start;
    while position + 8 <= end {
        if file.seek(SeekFrom::Start(position)).is_err() {
            return;
        }
        let mut chunk = [0_u8; 8];
        if file.read_exact(&mut chunk).is_err() {
            return;
        }
        let id = &chunk[0..4];
        let size = u32::from_le_bytes(match chunk[4..8].try_into() {
            Ok(value) => value,
            Err(_) => return,
        }) as u64;
        let data_start = position + 8;
        if size > end.saturating_sub(data_start) || size > 65536 {
            return;
        }
        let mut bytes = vec![0_u8; size as usize];
        if file.read_exact(&mut bytes).is_err() {
            return;
        }
        let Some(text) = decode_wav_info_text(&bytes) else {
            position = data_start + size + (size & 1);
            continue;
        };
        match id {
            b"INAM" => tags.title = Some(text),
            b"IART" => tags.artist = Some(text),
            b"IPRD" => tags.album = Some(text),
            b"ICMT" => tags.comment = Some(text),
            b"ICRD" => tags.year = parse_year(&text),
            b"ITRK" | b"IPRT" => tags.track = parse_track(&text),
            _ => {}
        }
        position = data_start + size + (size & 1);
    }
}

fn decode_wav_info_text(bytes: &[u8]) -> Option<String> {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    let bytes = &bytes[..end];
    if bytes.is_empty() {
        return None;
    }
    if let Ok(text) = str::from_utf8(bytes) {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }
    let (decoded, _, had_errors) = GBK.decode(bytes);
    if had_errors {
        return None;
    }
    let text = decoded.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn parse_year(text: &str) -> Option<u32> {
    text.trim()
        .get(..4)
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
}

fn parse_track(text: &str) -> Option<u16> {
    text.trim()
        .split(['/', '\\'])
        .next()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|value| *value > 0)
}

/// 大小写不敏感查找：原 ffmpeg-next 的 Dictionary::get 默认 case-insensitive，
/// 而 ffmpeg_audio 把 dict 转成普通 HashMap 后丢了这个语义，这里补回来
fn dict_get<'a>(dict: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    let target = tag_fields::normalize_tag_key(key);
    dict.iter()
        .find(|(k, _)| tag_fields::normalize_tag_key(k) == target)
        .map(|(_, v)| v.as_str())
}

/// 从容器 metadata 提取 ReplayGain / R128 增益值（dB）
///
/// 按优先级尝试：R128_TRACK_GAIN → replaygain_track_gain → album 版本
pub fn extract_replay_gain(dict: &HashMap<String, String>) -> Option<f32> {
    // EBU R128：值为 1/256 dB 单位的整数
    if let Some(val) =
        dict_get(dict, "R128_TRACK_GAIN").or_else(|| dict_get(dict, "R128_ALBUM_GAIN"))
    {
        if let Ok(raw) = val.trim().parse::<f32>() {
            return Some(raw / 256.0);
        }
    }

    // ReplayGain：格式如 "-6.50 dB"
    if let Some(val) =
        dict_get(dict, "replaygain_track_gain").or_else(|| dict_get(dict, "replaygain_album_gain"))
    {
        let cleaned = val.trim().trim_end_matches(" dB").trim_end_matches("dB");
        if let Ok(db) = cleaned.parse::<f32>() {
            return Some(db);
        }
    }

    None
}

/// 将 dB 增益转换为线性增益因子
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_tags_are_matched_case_insensitively() {
        let dict = HashMap::from([
            ("TITLE".to_string(), "Track".to_string()),
            ("Album_Artist".to_string(), "Artist".to_string()),
            ("DATE".to_string(), "1987-10-01".to_string()),
            ("TRACK".to_string(), "7/12".to_string()),
            ("DISCNUMBER".to_string(), "2/3".to_string()),
        ]);

        let tags = extract_tags(&dict);
        assert_eq!(tags.title.as_deref(), Some("Track"));
        assert_eq!(tags.artist.as_deref(), Some("Artist"));
        assert_eq!(tags.album_artist.as_deref(), Some("Artist"));
        assert_eq!(tags.year, Some(1987));
        assert_eq!(tags.track, Some(7));
        assert_eq!(tags.disc, Some(2));
    }

    #[test]
    fn invalid_year_falls_back_to_date() {
        let dict = HashMap::from([
            ("YEAR".to_string(), "".to_string()),
            ("DATE".to_string(), "1978-05-12".to_string()),
        ]);

        assert_eq!(extract_tags(&dict).year, Some(1978));
    }

    #[test]
    fn malformed_legacy_gbk_tags_are_repaired_only_when_title_matches_file_name() {
        let tags = Tags {
            title: Some("ÇôÄñ".to_string()),
            artist: Some("µË×ÏÆå".to_string()),
            album_artist: None,
            album: Some("ÔÚÏßÈÈËÑ£¨»ªÓï£©ÏµÁÐ63".to_string()),
            year: None,
            track: None,
            disc: None,
            comment: None,
        };
        let repaired = repair_legacy_gbk_tags_for_path(tags, "/music/囚鸟.mp3");

        assert_eq!(repaired.title.as_deref(), Some("囚鸟"));
        assert_eq!(repaired.artist.as_deref(), Some("邓紫棋"));
        assert_eq!(repaired.album.as_deref(), Some("在线热搜（华语）系列63"));
    }

    #[test]
    fn malformed_legacy_gbk_guess_does_not_override_unrelated_file_name() {
        let tags = Tags {
            title: Some("ÇôÄñ".to_string()),
            artist: Some("Beyoncé".to_string()),
            album_artist: None,
            album: Some("Album".to_string()),
            year: None,
            track: None,
            disc: None,
            comment: None,
        };
        let repaired = repair_legacy_gbk_tags_for_path(tags, "/music/Other Song.mp3");

        assert_eq!(repaired.title.as_deref(), Some("ÇôÄñ"));
        assert_eq!(repaired.artist.as_deref(), Some("Beyoncé"));
    }

    fn wav_info_fixture(path: &std::path::Path) {
        fn item(id: &[u8; 4], value: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(id);
            out.extend_from_slice(&((value.len() + 1) as u32).to_le_bytes());
            out.extend_from_slice(value);
            out.push(0);
            if (value.len() + 1) % 2 == 1 {
                out.push(0);
            }
            out
        }

        let mut info = b"INFO".to_vec();
        info.extend(item(b"INAM", b"\xb4\xba\xd1\xa9"));
        info.extend(item(b"IART", b"\xc3\xcf\xcd\xa5\xce\xad"));
        info.extend(item(
            b"IPRD",
            b"\xd5\xe6\xb5\xc4\xbb\xb9\xca\xc7\xbc\xd9\xb5\xc4",
        ));
        info.extend(item(b"ICRD", b"1995"));
        info.extend(item(b"ITRK", b"6"));

        let mut chunks = Vec::new();
        chunks.extend_from_slice(b"fmt ");
        chunks.extend_from_slice(&16u32.to_le_bytes());
        chunks.extend_from_slice(&1u16.to_le_bytes());
        chunks.extend_from_slice(&1u16.to_le_bytes());
        chunks.extend_from_slice(&8_000u32.to_le_bytes());
        chunks.extend_from_slice(&16_000u32.to_le_bytes());
        chunks.extend_from_slice(&2u16.to_le_bytes());
        chunks.extend_from_slice(&16u16.to_le_bytes());
        chunks.extend_from_slice(b"data");
        chunks.extend_from_slice(&4u32.to_le_bytes());
        chunks.extend_from_slice(&[0; 4]);
        chunks.extend_from_slice(b"LIST");
        chunks.extend_from_slice(&(info.len() as u32).to_le_bytes());
        chunks.extend_from_slice(&info);

        let mut wav = b"RIFF".to_vec();
        wav.extend_from_slice(&((chunks.len() + 4) as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(&chunks);
        std::fs::write(path, wav).unwrap();
    }

    #[test]
    fn wav_info_gbk_tags_are_decoded_from_raw_bytes() {
        assert_eq!(
            decode_wav_info_text(b"\xb4\xba\xd1\xa9\0"),
            Some("春雪".to_string())
        );
        assert_eq!(decode_wav_info_text(b"Pop\0"), Some("Pop".to_string()));

        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("春雪.wav");
        wav_info_fixture(&path);
        let tags = read_wav_info_tags(path.to_str().unwrap()).unwrap();
        assert_eq!(tags.title.as_deref(), Some("春雪"));
        assert_eq!(tags.artist.as_deref(), Some("孟庭苇"));
        assert_eq!(tags.album.as_deref(), Some("真的还是假的"));
        assert_eq!(tags.year, Some(1995));
        assert_eq!(tags.track, Some(6));
    }

    #[test]
    fn wav_ffmpeg_lossy_tags_fall_back_to_raw_info() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("春雪.wav");
        wav_info_fixture(&path);
        let dict = HashMap::from([
            ("title".to_string(), "��ѩ".to_string()),
            ("artist".to_string(), "��ͥέ".to_string()),
            ("album".to_string(), "���Ļ��Ǽٵ�".to_string()),
        ]);
        let tags = extract_tags_for_path(&dict, path.to_str().unwrap());
        assert_eq!(tags.title.as_deref(), Some("春雪"));
        assert_eq!(tags.artist.as_deref(), Some("孟庭苇"));
        assert_eq!(tags.album.as_deref(), Some("真的还是假的"));
    }

    #[test]
    fn r128_track_gain_has_priority_and_uses_fixed_point_units() {
        let dict = HashMap::from([
            ("R128_TRACK_GAIN".to_string(), "-1536".to_string()),
            ("replaygain_track_gain".to_string(), "-3.00 dB".to_string()),
        ]);

        assert_eq!(extract_replay_gain(&dict), Some(-6.0));
    }

    #[test]
    fn decibels_are_converted_to_linear_gain() {
        assert!((db_to_linear(-6.0) - 0.501_187_2).abs() < 0.000_001);
    }
}
