use anyhow::{ensure, Context, Result};
use tracing::warn;

use super::format::{pack_processed_pcm, AlsaPcmFormat};
use crate::shared::{AudioChunk, PreparedPcmChunk, Shared};

const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;

pub struct OutputLimiter {
    gain: f32,
}

impl Default for OutputLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl OutputLimiter {
    pub fn new() -> Self {
        Self { gain: 1.0 }
    }

    /// 最终增益之后，按完整多声道 frame 做削波保护。
    fn process(&mut self, samples: &mut [f32], channels: u16) {
        let channels = usize::from(channels);
        debug_assert!(channels > 0 && samples.len().is_multiple_of(channels));
        for frame in samples.chunks_exact_mut(channels) {
            let peak = frame
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
            let target_gain = if peak > OUTPUT_CEILING {
                OUTPUT_CEILING / peak
            } else {
                1.0
            };
            if peak * self.gain >= OUTPUT_CEILING {
                self.gain = target_gain;
            } else {
                self.gain += (1.0 - self.gain) * LIMITER_RELEASE;
            }
            for sample in frame {
                *sample = (*sample * self.gain).clamp(-OUTPUT_CEILING, OUTPUT_CEILING);
            }
        }
    }

    fn reset(&mut self) {
        self.gain = 1.0;
    }
}

fn apply_final_processing(
    samples: &mut [f32],
    gain: f32,
    channels: u16,
    clipping_protection: bool,
    limiter: &mut OutputLimiter,
) {
    if (gain - 1.0).abs() > f32::EPSILON {
        for sample in samples.iter_mut() {
            *sample *= gain;
        }
    }
    if clipping_protection {
        limiter.process(samples, channels);
    } else {
        limiter.reset();
    }
}

/// 在 DSP 生产线程准备最终字节，ALSA writer 只接收和提交已备块。
pub fn prepare_chunk(
    mut chunk: AudioChunk,
    shared: &Shared,
    format: AlsaPcmFormat,
    limiter: &mut OutputLimiter,
) -> Result<PreparedPcmChunk> {
    if chunk.track_boundary.is_some() {
        // staged 曲目沿用同一 writer，但下一首不能继承上一首的限幅历史。
        limiter.reset();
    }
    let channels = usize::from(shared.channels());
    ensure!(
        chunk.player_samples.len().is_multiple_of(channels),
        "processed PCM block 未按声道 frame 对齐"
    );
    let frames = (chunk.player_samples.len() / channels) as u64;
    let required = chunk
        .player_samples
        .len()
        .checked_mul(format.storage_bytes())
        .context("processed PCM pack 长度溢出")?;
    let mut bytes = shared.take_packed_buffer();
    bytes.resize(required, 0);
    apply_final_processing(
        &mut chunk.player_samples,
        shared.processed_volume(),
        shared.channels(),
        shared.clipping_protection(),
        limiter,
    );
    let result = pack_processed_pcm(&chunk.player_samples, 1.0, format, &mut bytes);
    shared.recycle_player_buffer(chunk.player_samples);
    let stats = result?;
    if stats.clipped {
        warn!("ALSA processed PCM 最终转换发生 clipping/sanitize");
    }
    bytes.truncate(stats.bytes);
    Ok(PreparedPcmChunk {
        bytes,
        frames,
        source_sample_count: chunk.source_sample_count,
        track_boundary: chunk.track_boundary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::ProcessedTrackBoundary;

    #[test]
    fn producer_prepares_final_bytes_and_keeps_timeline_metadata() {
        let shared = Shared::new(48_000, 2);
        shared.configure_processed_output(AlsaPcmFormat::F32Le, 0.5, false);
        let boundary = ProcessedTrackBoundary {
            generation: 3,
            duration_micros: 2_000_000,
        };
        let chunk = AudioChunk {
            player_samples: vec![0.5, -0.5, 1.0, -1.0],
            source_sample_count: 8,
            track_boundary: Some(boundary),
        };

        let prepared = prepare_chunk(
            chunk,
            &shared,
            AlsaPcmFormat::F32Le,
            &mut OutputLimiter::new(),
        )
        .unwrap();
        let samples: Vec<f32> = prepared
            .bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect();
        assert_eq!(samples, [0.25, -0.25, 0.5, -0.5]);
        assert_eq!(prepared.frames, 2);
        assert_eq!(prepared.source_sample_count, 8);
        assert_eq!(prepared.track_boundary, Some(boundary));
    }

    #[test]
    fn final_limiter_uses_one_gain_for_the_whole_multichannel_frame() {
        let mut limiter = OutputLimiter::new();
        let original = [2.0_f32, 1.0, 0.5, -0.5, -1.0, -2.0];
        let mut samples = original;
        limiter.process(&mut samples, 6);
        let gain = samples[0] / original[0];
        for (actual, input) in samples.iter().zip(original) {
            assert!((actual / input - gain).abs() < 1e-6);
        }
        assert!(samples.iter().all(|sample| sample.abs() <= OUTPUT_CEILING));
    }

    #[test]
    fn software_gain_is_applied_before_final_limiter() {
        let mut limiter = OutputLimiter::new();
        let mut samples = [0.8_f32, -0.8];
        apply_final_processing(&mut samples, 2.0, 2, true, &mut limiter);
        assert!(samples.iter().all(|sample| sample.abs() <= OUTPUT_CEILING));
        assert!((samples[0].abs() - samples[1].abs()).abs() < f32::EPSILON);
    }

    #[test]
    fn disabling_clipping_protection_resets_hidden_limiter_gain() {
        let mut limiter = OutputLimiter::new();
        let mut loud = [2.0_f32, -2.0];
        apply_final_processing(&mut loud, 1.0, 2, true, &mut limiter);
        assert!(loud[0].abs() <= OUTPUT_CEILING);
        let mut next = [0.5_f32, -0.5];
        apply_final_processing(&mut next, 1.0, 2, false, &mut limiter);
        assert_eq!(next, [0.5, -0.5]);
        assert!((limiter.gain - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn staged_track_does_not_inherit_previous_limiter_gain() {
        let shared = Shared::new(48_000, 2);
        shared.configure_processed_output(AlsaPcmFormat::F32Le, 1.0, true);
        let mut limiter = OutputLimiter::new();
        let first = AudioChunk {
            player_samples: vec![2.0, -2.0],
            source_sample_count: 2,
            track_boundary: None,
        };
        prepare_chunk(first, &shared, AlsaPcmFormat::F32Le, &mut limiter).unwrap();
        assert!(limiter.gain < 1.0);

        let next = AudioChunk {
            player_samples: vec![0.5, -0.5],
            source_sample_count: 2,
            track_boundary: Some(ProcessedTrackBoundary {
                generation: 2,
                duration_micros: 1_000_000,
            }),
        };
        let prepared = prepare_chunk(next, &shared, AlsaPcmFormat::F32Le, &mut limiter).unwrap();
        let left = f32::from_le_bytes(prepared.bytes[0..4].try_into().unwrap());
        assert!((left - 0.5).abs() < 1e-6);
    }
}
