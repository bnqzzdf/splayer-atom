use std::sync::Arc;

use anyhow::Result;
use tracing::warn;

use crate::alsa::processed_pcm::AlsaProcessedPcmStream;
use crate::audio_output::AudioOutput;
use crate::shared::Shared;

/// Processed PCM 播放控制句柄；底层 ALSA handle 始终由独立 writer 线程单独持有。
pub struct PlaybackHandle {
    stream: AlsaProcessedPcmStream,
    shared: Arc<Shared>,
}

impl PlaybackHandle {
    pub fn attach(
        output: &AudioOutput,
        shared: Arc<Shared>,
        volume: f32,
        clipping_protection: bool,
        paused: bool,
    ) -> Result<Self> {
        shared.set_processed_volume(volume);
        shared.set_clipping_protection(clipping_protection);
        Ok(Self {
            stream: output.build_stream(Arc::clone(&shared), paused)?,
            shared,
        })
    }

    pub fn play(&self) {
        if let Err(error) = self.stream.play() {
            warn!(%error, "恢复 ALSA processed 输出失败");
        }
    }

    pub fn pause(&self) {
        if let Err(error) = self.stream.pause() {
            warn!(%error, "暂停 ALSA processed 输出失败");
        }
    }

    pub fn stop(&self) {
        self.stream.stop();
    }

    pub fn set_volume(&self, volume: f32) {
        self.shared.set_processed_volume(volume);
    }

    pub fn set_clipping_protection(&self, enabled: bool) {
        self.shared.set_clipping_protection(enabled);
    }
}
