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

fn napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
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
