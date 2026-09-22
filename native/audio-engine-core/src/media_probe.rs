use std::fs::File;
use std::time::Duration;

use anyhow::{ensure, Context, Result};
use ffmpeg_audio::{AudioReader, HttpAudioSource, HttpCancelHandle, SeekMode};

use crate::cue::CueVirtualInfo;
use crate::metadata::{self, AudioMetadata};

/// 已打开且完成元数据探测的音源。
///
/// 这里只拥有输入、元数据与分轨信息，不创建播放重采样器或 DSP 实例。
pub struct PreparedMedia {
    pub(crate) reader: AudioReader,
    pub(crate) metadata: AudioMetadata,
    pub(crate) replay_gain_db: Option<f32>,
    pub(crate) cancel_handle: Option<HttpCancelHandle>,
    pub(crate) cue_info: Option<CueVirtualInfo>,
}

impl PreparedMedia {
    /// 音源原始采样率，供后续输出协商使用。
    pub fn original_sample_rate(&self) -> u32 {
        self.metadata.original_sample_rate
    }

    /// 源声道数；ALSA processed 必须保持声道语义，不允许隐式 remix。
    pub fn original_channels(&self) -> u16 {
        self.metadata.channels
    }

    /// 只消费探测结果，不启动播放链路。
    pub fn into_metadata(self) -> AudioMetadata {
        self.metadata
    }
}

pub fn probe_metadata(
    source: &str,
    cover_cache_dir: Option<&str>,
    cancel_handle: HttpCancelHandle,
) -> Result<AudioMetadata> {
    Ok(prepare_media(source, cover_cache_dir, cancel_handle)?.into_metadata())
}

pub fn prepare_media(
    source: &str,
    cover_cache_dir: Option<&str>,
    cancel_handle: HttpCancelHandle,
) -> Result<PreparedMedia> {
    let (reader, cancel_handle) = open_source(source, cancel_handle)?;
    let info = reader.source_info();
    let cue_info = crate::cue::parse_cue_virtual_path(source);
    let mut duration_secs = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    if let Some(cue) = &cue_info {
        if cue.duration > 0.0 {
            duration_secs = cue.duration;
        } else if duration_secs > cue.start_time {
            duration_secs -= cue.start_time;
        }
    }

    let stream_info = metadata::extract_stream_info(info);
    ensure!(stream_info.channels > 0, "源音频没有有效声道");
    let source_channels = u16::try_from(stream_info.channels).context("源音频声道数超出范围")?;
    let codec = info.codec_name.clone().unwrap_or_default();
    let raw_metadata = reader.metadata();
    let tags =
        metadata::repair_legacy_gbk_tags_for_path(metadata::extract_tags(&raw_metadata), source);
    let cover =
        cover_cache_dir.and_then(|dir| metadata::extract_cover_thumbnail(&reader, source, dir));
    let cover_raw = metadata::read_attached_pic(&reader);
    let embedded_lyric = metadata::extract_embedded_lyric(&raw_metadata);
    let external_lyrics = metadata::find_all_external_lyrics(source);
    let replay_gain_db = metadata::extract_replay_gain(&raw_metadata);

    Ok(PreparedMedia {
        reader,
        metadata: AudioMetadata {
            title: tags.title,
            artist: tags.artist,
            album: tags.album,
            comment: tags.comment,
            duration_secs,
            sample_rate: stream_info.sample_rate,
            channels: source_channels,
            original_sample_rate: stream_info.sample_rate,
            bits_per_sample: stream_info.bits_per_sample,
            bit_rate: stream_info.bit_rate,
            codec,
            embedded_lyric,
            external_lyrics,
            cover,
            cover_raw,
        },
        replay_gain_db,
        cancel_handle,
        cue_info,
    })
}

/// 根据 source 类型建立可 seek 的输入；不包含任何输出或 DSP 决策。
fn open_source(
    source: &str,
    cancel_handle: HttpCancelHandle,
) -> Result<(AudioReader, Option<HttpCancelHandle>)> {
    if crate::sacd::parse_sacd_virtual_path(source).is_some() {
        let stream = crate::sacd::SacdDsfStream::open_virtual_path(source)
            .with_context(|| format!("打开 SACD 虚拟分轨失败: {source}"))?;
        let reader = AudioReader::new(stream)
            .with_context(|| format!("打开 SACD 虚拟 DSF 流失败: {source}"))?;
        return Ok((reader, None));
    }

    if let Some(cue_info) = crate::cue::parse_cue_virtual_path(source) {
        let file = File::open(&cue_info.physical_path)
            .with_context(|| format!("打开 CUE 关联母版音频失败: {}", cue_info.physical_path))?;
        let mut reader = AudioReader::new(file)
            .with_context(|| format!("打开 CUE 关联音频流失败: {}", cue_info.physical_path))?;
        if cue_info.start_time > 0.0 {
            let target = Duration::from_secs_f64(cue_info.start_time);
            let _ = reader.seek(target, SeekMode::Accurate);
        }
        return Ok((reader, None));
    }

    if source.starts_with("http://") || source.starts_with("https://") {
        let http = HttpAudioSource::new_with_cancel_handle(source, &cancel_handle)?;
        let reader =
            AudioReader::new(http).with_context(|| format!("打开网络音频失败: {source}"))?;
        return Ok((reader, Some(cancel_handle)));
    }

    let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
    let reader = AudioReader::new(file).with_context(|| format!("打开本地音频失败: {source}"))?;
    Ok((reader, None))
}
