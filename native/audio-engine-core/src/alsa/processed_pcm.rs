use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use alsa::pcm::State;
use anyhow::{ensure, Context, Result};
use tracing::warn;

use super::format::pack_processed_pcm;
use super::output::AlsaPcmHandle;
use super::writer::AlsaFrameWriter;
use crate::audio_output::OutputFailureCallback;
use crate::shared::{PopResult, ProcessedTrackBoundary, Shared};

const SOURCE_POLL_INTERVAL: Duration = Duration::from_millis(1);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;

struct OutputLimiter {
    gain: f32,
}

impl OutputLimiter {
    fn new() -> Self {
        Self { gain: 1.0 }
    }

    /// 软件音量/fade 已应用后，按完整多声道 frame 做最终 clipping protection。
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

enum WriterCommand {
    Play(mpsc::SyncSender<Result<()>>),
    Pause(mpsc::SyncSender<Result<()>>),
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TimelineSegment {
    start_frame: u64,
    end_frame: u64,
    start_source_samples: u64,
    end_source_samples: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PendingTrackBoundary {
    frame: u64,
    source_sample_base: u64,
    boundary: ProcessedTrackBoundary,
}

#[derive(Debug, Default)]
struct PlayedTimeline {
    submitted_frames: u64,
    submitted_source_samples: u64,
    played_source_samples: u64,
    segments: VecDeque<TimelineSegment>,
}

impl PlayedTimeline {
    fn push(&mut self, frames: u64, source_samples: u64) {
        if frames == 0 {
            return;
        }
        let segment = TimelineSegment {
            start_frame: self.submitted_frames,
            end_frame: self.submitted_frames.saturating_add(frames),
            start_source_samples: self.submitted_source_samples,
            end_source_samples: self.submitted_source_samples.saturating_add(source_samples),
        };
        self.submitted_frames = segment.end_frame;
        self.submitted_source_samples = segment.end_source_samples;
        self.segments.push_back(segment);
    }

    fn played_to(&mut self, played_frames: u64) -> u64 {
        let played_frames = played_frames.min(self.submitted_frames);
        while self
            .segments
            .front()
            .is_some_and(|segment| segment.end_frame <= played_frames)
        {
            let segment = self.segments.pop_front().expect("front 已确认存在");
            self.played_source_samples = self.played_source_samples.max(segment.end_source_samples);
        }
        if let Some(segment) = self.segments.front() {
            if played_frames > segment.start_frame {
                let frame_offset = played_frames - segment.start_frame;
                let frame_span = segment.end_frame - segment.start_frame;
                let source_span = segment.end_source_samples - segment.start_source_samples;
                let partial = (u128::from(source_span) * u128::from(frame_offset)
                    / u128::from(frame_span)) as u64;
                self.played_source_samples = self
                    .played_source_samples
                    .max(segment.start_source_samples.saturating_add(partial));
            }
        }
        self.played_source_samples
    }

    /// Processed XRUN recovery 后，旧 HW queue 已经不再可信；把未播放部分记为 discontinuity 并开新 epoch。
    fn reset_after_discontinuity(&mut self) -> u64 {
        self.played_source_samples = self.submitted_source_samples;
        self.submitted_frames = 0;
        self.segments.clear();
        self.played_source_samples
    }

    /// 已经完整 drain 的旧 HW queue 可以安全结束，不是 discontinuity。
    /// 新一轮 `prepare -> play` 必须从 frame 0 建立新的硬件 epoch，但媒体源累计位置保持不变。
    fn reset_after_clean_drain(&mut self) -> u64 {
        self.played_source_samples = self.submitted_source_samples;
        self.submitted_frames = 0;
        self.segments.clear();
        self.played_source_samples
    }
}

pub struct AlsaProcessedPcmStream {
    command_tx: mpsc::Sender<WriterCommand>,
    volume: Arc<AtomicU32>,
    clipping_protection: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl AlsaProcessedPcmStream {
    pub fn new(
        handle: AlsaPcmHandle,
        shared: Arc<Shared>,
        volume: f32,
        clipping_protection: bool,
        paused: bool,
        on_failure: OutputFailureCallback,
    ) -> Result<Self> {
        let volume = Arc::new(AtomicU32::new(volume.to_bits()));
        let clipping_protection = Arc::new(AtomicBool::new(clipping_protection));
        let cancel = Arc::new(AtomicBool::new(false));
        let (command_tx, command_rx) = mpsc::channel();
        let worker_volume = Arc::clone(&volume);
        let worker_clipping_protection = Arc::clone(&clipping_protection);
        let worker_cancel = Arc::clone(&cancel);
        let worker = thread::Builder::new()
            .name("alsa-processed-pcm".into())
            .spawn(move || {
                if let Err(error) = run_writer(
                    handle,
                    shared,
                    worker_volume,
                    worker_clipping_protection,
                    worker_cancel.as_ref(),
                    command_rx,
                    !paused,
                ) {
                    warn!(%error, "ALSA processed PCM writer 失败");
                    on_failure();
                }
            })
            .context("启动 ALSA processed PCM writer 失败")?;
        Ok(Self {
            command_tx,
            volume,
            clipping_protection,
            cancel,
            worker: Some(worker),
        })
    }

    pub fn play(&self) -> Result<()> {
        self.request(WriterCommand::Play)
    }

    pub fn pause(&self) -> Result<()> {
        self.request(WriterCommand::Pause)
    }

    fn request(
        &self,
        command: impl FnOnce(mpsc::SyncSender<Result<()>>) -> WriterCommand,
    ) -> Result<()> {
        let (response_tx, response_rx) = mpsc::sync_channel(0);
        self.command_tx
            .send(command(response_tx))
            .context("提交 ALSA processed 控制命令失败")?;
        response_rx
            .recv()
            .context("等待 ALSA processed 控制命令失败")?
    }

    pub fn set_volume(&self, volume: f32) {
        self.volume.store(volume.to_bits(), Ordering::Relaxed);
    }

    pub fn set_clipping_protection(&self, enabled: bool) {
        self.clipping_protection.store(enabled, Ordering::Release);
    }

    pub fn stop(&self) {
        self.cancel.store(true, Ordering::Release);
        let _ = self.command_tx.send(WriterCommand::Stop);
    }
}

impl Drop for AlsaProcessedPcmStream {
    fn drop(&mut self) {
        self.stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run_writer(
    handle: AlsaPcmHandle,
    shared: Arc<Shared>,
    volume: Arc<AtomicU32>,
    clipping_protection: Arc<AtomicBool>,
    cancel: &AtomicBool,
    command_rx: mpsc::Receiver<WriterCommand>,
    mut playing: bool,
) -> Result<()> {
    let config = handle.config();
    let mut writer = AlsaFrameWriter::new(handle)?;
    let mut hardware_paused = false;
    let mut timeline = PlayedTimeline::default();
    let mut pending_source_samples = 0_u64;
    let mut pending_chunk_boundary: Option<ProcessedTrackBoundary> = None;
    let mut pending_track_boundaries = VecDeque::<PendingTrackBoundary>::new();
    let mut packed = Vec::<u8>::new();
    let mut limiter = OutputLimiter::new();

    loop {
        if cancel.load(Ordering::Acquire) || shared.is_stopping() {
            let _ = writer.drop_stream();
            return Ok(());
        }
        if !playing {
            let command = command_rx.recv().context("ALSA processed 控制通道已关闭")?;
            if handle_command(
                command,
                &writer,
                &shared,
                &mut timeline,
                &mut pending_track_boundaries,
                &mut playing,
                &mut hardware_paused,
            )? {
                return Ok(());
            }
            continue;
        }
        while let Ok(command) = command_rx.try_recv() {
            if handle_command(
                command,
                &writer,
                &shared,
                &mut timeline,
                &mut pending_track_boundaries,
                &mut playing,
                &mut hardware_paused,
            )? {
                return Ok(());
            }
            if !playing {
                break;
            }
        }
        if !playing {
            continue;
        }

        match shared.try_pop() {
            PopResult::Chunk(mut chunk) => {
                if chunk.track_boundary.is_some() {
                    pending_chunk_boundary = chunk.track_boundary.take();
                }
                pending_source_samples =
                    pending_source_samples.saturating_add(chunk.source_sample_count);
                if chunk.player_samples.is_empty() {
                    shared.recycle_player_buffer(chunk.player_samples);
                    continue;
                }
                if let Some(boundary) = pending_chunk_boundary.take() {
                    pending_track_boundaries.push_back(PendingTrackBoundary {
                        frame: timeline.submitted_frames,
                        source_sample_base: timeline.submitted_source_samples,
                        boundary,
                    });
                }
                let frames = chunk.player_samples.len() / usize::from(config.channels);
                ensure!(
                    frames * usize::from(config.channels) == chunk.player_samples.len(),
                    "processed PCM block 未按声道 frame 对齐"
                );
                let required = chunk
                    .player_samples
                    .len()
                    .checked_mul(config.format.storage_bytes())
                    .context("processed PCM pack 长度溢出")?;
                packed.resize(required, 0);
                let gain = f32::from_bits(volume.load(Ordering::Relaxed));
                apply_final_processing(
                    &mut chunk.player_samples,
                    gain,
                    config.channels,
                    clipping_protection.load(Ordering::Acquire),
                    &mut limiter,
                );
                let stats =
                    pack_processed_pcm(&chunk.player_samples, 1.0, config.format, &mut packed)?;
                if stats.clipped {
                    warn!("ALSA processed PCM 最终转换发生 clipping/sanitize");
                }
                shared.recycle_player_buffer(std::mem::take(&mut chunk.player_samples));

                let (written, recovered) = writer
                    .write_all_recovering(&packed[..stats.bytes], || {
                        cancel.load(Ordering::Acquire) || shared.is_stopping()
                    })?;
                ensure!(
                    written == frames,
                    "ALSA processed write frame 数与 block 不一致"
                );
                if recovered {
                    let skipped = timeline.reset_after_discontinuity();
                    shared.set_consumed_samples(skipped);
                    commit_track_boundaries_by_source(
                        &shared,
                        &mut pending_track_boundaries,
                        skipped,
                    );
                    warn!("ALSA processed PCM 已从 XRUN/suspend 恢复，播放存在 discontinuity");
                }
                timeline.push(written as u64, pending_source_samples);
                pending_source_samples = 0;
                update_played(
                    &writer,
                    &shared,
                    &mut timeline,
                    &mut pending_track_boundaries,
                )?;
            }
            PopResult::Pending => {
                update_played(
                    &writer,
                    &shared,
                    &mut timeline,
                    &mut pending_track_boundaries,
                )?;
                thread::sleep(SOURCE_POLL_INTERVAL);
            }
            PopResult::Finished => {
                if shared.is_stopping() {
                    let _ = writer.drop_stream();
                    return Ok(());
                }
                drain_stream(
                    &writer,
                    &shared,
                    &mut timeline,
                    &mut pending_track_boundaries,
                    cancel,
                )?;
                if pending_source_samples > 0 {
                    shared.set_consumed_samples(
                        timeline
                            .submitted_source_samples
                            .saturating_add(pending_source_samples),
                    );
                }
                shared.mark_all_consumed();
                playing = false;
            }
        }
    }
}

fn handle_command(
    command: WriterCommand,
    writer: &AlsaFrameWriter,
    shared: &Shared,
    timeline: &mut PlayedTimeline,
    pending_track_boundaries: &mut VecDeque<PendingTrackBoundary>,
    playing: &mut bool,
    hardware_paused: &mut bool,
) -> Result<bool> {
    match command {
        WriterCommand::Play(response) => {
            let result = (|| {
                if *hardware_paused {
                    writer.pause(false)?;
                    *hardware_paused = false;
                }
                *playing = true;
                Ok(())
            })();
            let failed = result.is_err();
            let _ = response.send(result);
            if failed {
                return Ok(true);
            }
        }
        WriterCommand::Pause(response) => {
            let result = if !*playing {
                Ok(())
            } else if writer.can_pause() && writer.state() == State::Running {
                writer.pause(true).map(|_| *hardware_paused = true)
            } else if writer.can_pause() && writer.state() == State::Paused {
                *hardware_paused = true;
                Ok(())
            } else {
                drain_stream(
                    writer,
                    shared,
                    timeline,
                    pending_track_boundaries,
                    &AtomicBool::new(false),
                )?;
                let played_source_samples = timeline.reset_after_clean_drain();
                shared.set_consumed_samples(played_source_samples);
                writer.prepare()
            };
            if result.is_ok() {
                *playing = false;
            }
            let failed = result.is_err();
            let _ = response.send(result);
            if failed {
                return Ok(true);
            }
        }
        WriterCommand::Stop => {
            let _ = writer.drop_stream();
            return Ok(true);
        }
    }
    Ok(false)
}

fn update_played(
    writer: &AlsaFrameWriter,
    shared: &Shared,
    timeline: &mut PlayedTimeline,
    pending_track_boundaries: &mut VecDeque<PendingTrackBoundary>,
) -> Result<()> {
    let played_frames = match writer.state() {
        State::Prepared | State::Setup | State::Open => 0,
        State::XRun => return Ok(()),
        _ => {
            let delay = u64::try_from(writer.delay()?.max(0)).unwrap_or(u64::MAX);
            timeline.submitted_frames.saturating_sub(delay)
        }
    };
    let source_samples = timeline.played_to(played_frames);
    shared.set_consumed_samples(source_samples);
    commit_track_boundaries_by_frame(shared, pending_track_boundaries, played_frames);
    Ok(())
}

fn commit_track_boundaries_by_frame(
    shared: &Shared,
    pending: &mut VecDeque<PendingTrackBoundary>,
    played_frames: u64,
) {
    while pending
        .front()
        .is_some_and(|boundary| boundary.frame <= played_frames)
    {
        let boundary = pending.pop_front().expect("front 已确认存在");
        shared.commit_track_boundary(boundary.source_sample_base, boundary.boundary);
    }
}

fn commit_track_boundaries_by_source(
    shared: &Shared,
    pending: &mut VecDeque<PendingTrackBoundary>,
    played_source_samples: u64,
) {
    while pending
        .front()
        .is_some_and(|boundary| boundary.source_sample_base <= played_source_samples)
    {
        let boundary = pending.pop_front().expect("front 已确认存在");
        shared.commit_track_boundary(boundary.source_sample_base, boundary.boundary);
    }
}

fn drain_stream(
    writer: &AlsaFrameWriter,
    shared: &Shared,
    timeline: &mut PlayedTimeline,
    pending_track_boundaries: &mut VecDeque<PendingTrackBoundary>,
    cancel: &AtomicBool,
) -> Result<()> {
    if timeline.submitted_frames == 0 {
        return Ok(());
    }
    if writer.state() == State::Prepared {
        writer.start()?;
    }
    let deadline = Instant::now() + DRAIN_TIMEOUT;
    loop {
        ensure!(
            !cancel.load(Ordering::Acquire),
            "ALSA processed drain 已取消"
        );
        match writer.drain_once() {
            Ok(()) => {
                let source_samples = timeline.played_to(timeline.submitted_frames);
                shared.set_consumed_samples(source_samples);
                commit_track_boundaries_by_frame(
                    shared,
                    pending_track_boundaries,
                    timeline.submitted_frames,
                );
                return Ok(());
            }
            Err(error) if matches!(error.errno(), libc::EAGAIN | libc::EINTR) => {
                update_played(writer, shared, timeline, pending_track_boundaries)?;
                ensure!(Instant::now() < deadline, "ALSA processed drain 超时");
                let _ = writer.wait(100)?;
            }
            Err(error) => {
                return Err(anyhow::anyhow!(error).context("ALSA processed drain 失败"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_maps_tempo_changed_output_frames_back_to_source_samples() {
        let mut timeline = PlayedTimeline::default();
        timeline.push(100, 200);
        timeline.push(200, 200);
        assert_eq!(timeline.played_to(50), 100);
        assert_eq!(timeline.played_to(100), 200);
        assert_eq!(timeline.played_to(200), 300);
        assert_eq!(timeline.played_to(300), 400);
    }

    #[test]
    fn timeline_is_monotonic_across_multiple_segments() {
        let mut timeline = PlayedTimeline::default();
        timeline.push(10, 20);
        timeline.push(10, 40);
        assert_eq!(timeline.played_to(15), 40);
        assert_eq!(timeline.played_to(12), 40);
        assert_eq!(timeline.played_to(20), 60);
    }

    #[test]
    fn discontinuity_drops_old_hw_epoch_without_rewinding_source_time() {
        let mut timeline = PlayedTimeline::default();
        timeline.push(100, 200);
        assert_eq!(timeline.played_to(25), 50);
        assert_eq!(timeline.reset_after_discontinuity(), 200);
        timeline.push(50, 100);
        assert_eq!(timeline.played_to(25), 250);
        assert_eq!(timeline.played_to(50), 300);
    }

    #[test]
    fn processed_boundary_commits_only_after_dac_side_frame_reaches_it() {
        let shared = Shared::new(48_000, 2);
        let mut pending = VecDeque::from([PendingTrackBoundary {
            frame: 100,
            source_sample_base: 200,
            boundary: ProcessedTrackBoundary {
                generation: 9,
                duration_micros: 2_000_000,
            },
        }]);
        commit_track_boundaries_by_frame(&shared, &mut pending, 99);
        assert_eq!(shared.track_transition_count(), 0);
        commit_track_boundaries_by_frame(&shared, &mut pending, 100);
        assert_eq!(shared.track_transition_count(), 1);
        assert_eq!(shared.track_boundary_generation(), 9);
        assert_eq!(shared.track_duration(), 2.0);
        shared.set_consumed_samples(200);
        assert_eq!(shared.consumed_position(), 0.0);
    }

    #[test]
    fn clean_pause_drain_starts_new_hw_epoch_without_position_jump() {
        let mut timeline = PlayedTimeline::default();
        timeline.push(100, 200);
        assert_eq!(timeline.played_to(100), 200);
        assert_eq!(timeline.reset_after_clean_drain(), 200);

        timeline.push(50, 100);
        assert_eq!(timeline.played_to(0), 200);
        assert_eq!(timeline.played_to(25), 250);
        assert_eq!(timeline.played_to(50), 300);
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
}
