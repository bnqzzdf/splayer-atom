//! Atom Headless 的普通 PCM 输出配置。
//!
//! Direct / Processed 共用同一组 ALSA `hw:` 端点身份和底层 writer；这里仅负责 Processed PCM
//! 的设备协商。没有 desktop default、plughw、softvol 或 CPAL fallback。

use std::sync::Arc;

use anyhow::{ensure, Context, Result};
use tracing::{debug, info};

use crate::alsa::device::AlsaHwEndpoint;
use crate::alsa::format::AlsaPcmFormat;
use crate::alsa::output::{open_processed_pcm_hw, AlsaPcmConfig};
use crate::alsa::processed_pcm::AlsaProcessedPcmStream;
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::shared::Shared;

/// 输出失败回调：writer 线程调用，只允许发送轻量事件。
/// 禁止获取 `InnerPlayer` 锁、join 线程、枚举设备或调用 NAPI async 方法。
pub type OutputFailureCallback = Arc<dyn Fn() + Send + Sync + 'static>;

/// Processed PCM 输出配置。
///
/// 只保存稳定 endpoint 和协商结果；真正的 ALSA handle 在 `build_stream()` 中由 writer 独占。
pub struct AudioOutput {
    endpoint: AlsaHwEndpoint,
    config: AlsaPcmConfig,
    generation: u64,
    on_failure: OutputFailureCallback,
}

fn validate_processed_channels(channels: u16) -> Result<()> {
    ensure!(
        matches!(channels, 1 | 2),
        "processed PCM 当前仅支持 mono/stereo；多声道需要显式 channel-layout 保真后才能启用"
    );
    Ok(())
}

impl AudioOutput {
    pub fn new(
        device_id: Option<&str>,
        requested_sample_rate: Option<u32>,
        requested_channels: Option<u16>,
        generation: u64,
        on_failure: OutputFailureCallback,
    ) -> Result<Self> {
        let selector = device_id.context("[Device] 未选择 ALSA HW 输出")?;
        let endpoint = AlsaHwEndpoint::parse(selector).with_audio_kind(AudioErrorKind::Device)?;
        let requested_sample_rate = requested_sample_rate.context("processed PCM 缺少源采样率")?;
        let requested_channels = requested_channels.context("processed PCM 缺少源声道数")?;
        validate_processed_channels(requested_channels)?;
        let handle = open_processed_pcm_hw(&endpoint, requested_sample_rate, requested_channels)
            .with_audio_kind(AudioErrorKind::Device)?;
        let config = handle.config();
        drop(handle);
        info!(
            id = %endpoint,
            sample_rate = config.sample_rate,
            channels = config.channels,
            format = ?config.format,
            "打开 ALSA processed 输出配置"
        );
        Ok(Self {
            endpoint,
            config,
            generation,
            on_failure,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.config.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.config.channels
    }

    pub fn format(&self) -> AlsaPcmFormat {
        self.config.format
    }

    pub(crate) fn build_stream(
        &self,
        shared: Arc<Shared>,
        paused: bool,
    ) -> Result<AlsaProcessedPcmStream> {
        let handle = open_processed_pcm_hw(
            &self.endpoint,
            self.config.sample_rate,
            self.config.channels,
        )
        .with_audio_kind(AudioErrorKind::Device)?;
        let actual = handle.config();
        ensure!(
            actual.sample_rate == self.config.sample_rate
                && actual.channels == self.config.channels
                && actual.format == self.config.format,
            "ALSA processed 重开后的 format/rate/channels 与已准备输出块不一致"
        );
        AlsaProcessedPcmStream::new(handle, shared, paused, Arc::clone(&self.on_failure))
            .with_audio_kind(AudioErrorKind::Device)
    }
}

impl Drop for AudioOutput {
    fn drop(&mut self) {
        debug!(generation = self.generation, id = %self.endpoint, "释放 ALSA processed 输出配置");
    }
}

/// 只枚举真实 ALSA playback PCM，不返回 desktop default/plughw/softvol。
pub fn list_output_devices() -> Vec<(String, String, bool)> {
    let list = crate::alsa::device::list_hw_playback_devices()
        .map(|devices| {
            devices
                .into_iter()
                .map(|device| (device.endpoint.selector(), device.name, false))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    debug!(devices = ?list, "枚举 ALSA HW playback 设备");
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn processed_channels_are_limited_until_explicit_layout_is_available() {
        assert!(validate_processed_channels(1).is_ok());
        assert!(validate_processed_channels(2).is_ok());
        let error = validate_processed_channels(6).unwrap_err().to_string();
        assert!(error.contains("channel-layout"));
    }
}
