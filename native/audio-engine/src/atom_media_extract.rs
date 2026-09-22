use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct JsCueWavExtractResult {
    pub sample_rate: u32,
    pub channels: u16,
    pub valid_bits: u32,
    pub storage_bits: u32,
    pub samples_per_channel: f64,
    pub duration_ms: f64,
}

#[napi(object)]
pub struct JsDsdExtractResult {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_channel: f64,
    pub duration_ms: f64,
}

#[napi(object)]
pub struct JsMediaQuality {
    pub sample_rate: u32,
    pub channels: u32,
    pub bits_per_sample: u32,
    pub bit_rate: i64,
    pub codec: String,
}

fn napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

/// Atom 曲库把一个 SACD ISO 展开为稳定虚拟分轨；解析工作在阻塞线程完成。
#[napi]
pub async fn probe_sacd_tracks(iso_path: String) -> Result<Vec<crate::bindings::JsScannedTrack>> {
    let tracks = tokio::task::spawn_blocking(move || {
        audio_engine_core::scanner::probe_sacd_tracks(&iso_path)
    })
    .await
    .map_err(napi_error)?;
    Ok(tracks.into_iter().map(Into::into).collect())
}

/// Atom 对单个普通音频做与批量 scanner 相同的完整探测，用于 Folder 定向 canonicalize。
#[napi]
pub async fn probe_scanned_track(
    path: String,
    cover_cache_dir: Option<String>,
) -> Result<crate::bindings::JsScannedTrack> {
    let probe_path = path.clone();
    let track = tokio::task::spawn_blocking(move || {
        audio_engine_core::scanner::probe_fast(&probe_path, cover_cache_dir.as_deref())
    })
    .await
    .map_err(napi_error)?
    .ok_or_else(|| Error::from_reason(format!("无法读取媒体元数据: {path}")))?;
    Ok(track.into())
}

/// Atom UPnP 对已经落到本地的媒体文件读取真实编码参数；不创建 AudioPlayer。
#[napi]
pub async fn probe_media_quality(path: String) -> Result<JsMediaQuality> {
    let probe_path = path.clone();
    let track = tokio::task::spawn_blocking(move || {
        audio_engine_core::scanner::probe_fast(&probe_path, None)
    })
    .await
    .map_err(napi_error)?
    .ok_or_else(|| Error::from_reason(format!("无法读取媒体编码参数: {path}")))?;
    Ok(JsMediaQuality {
        sample_rate: track.sample_rate,
        channels: track.channels,
        bits_per_sample: track.bits_per_sample,
        bit_rate: track.bit_rate,
        codec: track.codec,
    })
}

/// Atom UPnP 使用的离线 CUE WAV 提取；不创建 AudioPlayer 或音频设备。
#[napi]
pub async fn extract_cue_wav(
    cue_path: String,
    track_num: u32,
    output_path: String,
) -> Result<JsCueWavExtractResult> {
    let track_num = u16::try_from(track_num).map_err(napi_error)?;
    let result = tokio::task::spawn_blocking(move || {
        audio_engine_core::media_extract::extract_cue_track_to_wav(
            &PathBuf::from(cue_path),
            track_num,
            &PathBuf::from(output_path),
        )
    })
    .await
    .map_err(napi_error)?
    .map_err(napi_error)?;
    Ok(JsCueWavExtractResult {
        sample_rate: result.sample_rate,
        channels: result.channels,
        valid_bits: u32::from(result.valid_bits),
        storage_bits: u32::from(result.storage_bits),
        samples_per_channel: result.samples_per_channel as f64,
        duration_ms: result.duration_ms as f64,
    })
}

/// Atom UPnP 使用的离线 DSD CUE -> DSF 提取。
#[napi]
pub async fn extract_cue_dsf(
    cue_path: String,
    track_num: u32,
    output_path: String,
) -> Result<JsDsdExtractResult> {
    let track_num = u16::try_from(track_num).map_err(napi_error)?;
    let result = tokio::task::spawn_blocking(move || {
        audio_engine_core::media_extract::extract_cue_track_to_dsf(
            &PathBuf::from(cue_path),
            track_num,
            &PathBuf::from(output_path),
        )
    })
    .await
    .map_err(napi_error)?
    .map_err(napi_error)?;
    Ok(JsDsdExtractResult {
        sample_rate: result.sample_rate,
        channels: result.channels,
        bits_per_channel: result.bits_per_channel as f64,
        duration_ms: result.duration_ms as f64,
    })
}

/// Atom UPnP 使用的离线 SACD stereo track -> DSF 提取。
#[napi]
pub async fn extract_sacd_dsf(
    iso_path: String,
    track_num: u32,
    output_path: String,
) -> Result<JsDsdExtractResult> {
    let track_num = u16::try_from(track_num).map_err(napi_error)?;
    let result = tokio::task::spawn_blocking(move || {
        audio_engine_core::media_extract::extract_sacd_track_to_dsf(
            &PathBuf::from(iso_path),
            track_num,
            &PathBuf::from(output_path),
        )
    })
    .await
    .map_err(napi_error)?
    .map_err(napi_error)?;
    Ok(JsDsdExtractResult {
        sample_rate: result.sample_rate,
        channels: result.channels,
        bits_per_channel: result.bits_per_channel as f64,
        duration_ms: result.duration_ms as f64,
    })
}
