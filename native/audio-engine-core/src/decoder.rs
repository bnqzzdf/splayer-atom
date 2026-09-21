use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use ffmpeg_audio::{
    sys, AudioError, AudioReader, HttpCancelHandle, ResampleOptions, Resampler, SeekMode,
};
use parking_lot::Mutex;
use tracing::debug;

use crate::cue::CueVirtualInfo;
use crate::equalizer::Equalizer;
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::loudness::LoudnessAnalyzer;
use crate::media_probe::{self, PreparedMedia};
use crate::metadata::{self, AudioMetadata};
use crate::priority;
use crate::shared::{AudioChunk, ProcessedTrackBoundary, Shared};
use crate::tempo::StretchProcessor;

/// 无输出设备信息时初始化 DSP 使用的默认声道数
pub const DEFAULT_OUTPUT_CHANNELS: u16 = 2;

/// 播放输出默认采样率
pub const DEFAULT_TARGET_SAMPLE_RATE: u32 = 48_000;

/// FFT 计算所需的目标采样率
pub const FFT_TARGET_SAMPLE_RATE: u32 = 48_000;

/// FFT 始终分析双声道视图，与真实播放输出声道链路相互独立
const FFT_CHANNELS: u16 = 2;

/// 自定义 File IO 读取失败时，ffmpeg_audio 的 read 回调可能映射为此错误码
const AVERROR_EIO: i32 = sys::averror(libc::EIO);

/// 解码会话所需的资源（跨 seek 复用，避免重建 ffmpeg_audio 上下文）
///
/// 此处必须进行 1-to-N 分发，因为需要两个可能存在采样率差异的音源
///  - 播放重采样器输出设备采样率、设备声道数的交错 f32
///  - FFT 重采样器输出 48kHz 的 stereo f32
pub struct DecoderData {
    reader: AudioReader,
    player_resampler: Resampler,
    fft_resampler: Resampler,
    /// 网络中断句柄仅由远端源持有，stop() 取消后可在 seek 前重置
    cancel_handle: Option<HttpCancelHandle>,
    /// CUE 虚拟分轨及当前相对位置，用于精确限制解码边界
    cue_info: Option<CueVirtualInfo>,
    cue_position_secs: f64,
}

pub type PreparedDecoder = PreparedMedia;

pub struct StagedProcessedDecoder {
    data: DecoderData,
    metadata: AudioMetadata,
    normalization_gain: f32,
    generation: u64,
}

impl StagedProcessedDecoder {
    pub fn metadata(&self) -> AudioMetadata {
        self.metadata.clone()
    }

    fn cancel(&self) {
        if let Some(handle) = self.data.cancel_handle() {
            handle.cancel();
        }
    }
}

struct ProcessedStageState {
    slot: Mutex<Option<StagedProcessedDecoder>>,
    closed: AtomicBool,
    epoch: std::sync::atomic::AtomicU64,
}

#[derive(Clone)]
pub struct ProcessedStageHandle {
    state: Arc<ProcessedStageState>,
}

impl ProcessedStageHandle {
    fn new() -> Self {
        Self {
            state: Arc::new(ProcessedStageState {
                slot: Mutex::new(None),
                closed: AtomicBool::new(false),
                epoch: std::sync::atomic::AtomicU64::new(0),
            }),
        }
    }

    /// 为一次异步 prepare 预留代次；晚到结果只有代次仍匹配时才能安装。
    pub fn begin_stage(&self) -> u64 {
        let epoch = self.state.epoch.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some(previous) = self.state.slot.lock().take() {
            previous.cancel();
        }
        epoch
    }

    pub fn stage_if_current(&self, epoch: u64, staged: StagedProcessedDecoder) -> bool {
        if self.state.closed.load(Ordering::Acquire) {
            staged.cancel();
            return false;
        }
        let mut slot = self.state.slot.lock();
        if self.state.closed.load(Ordering::Acquire)
            || self.state.epoch.load(Ordering::Acquire) != epoch
        {
            drop(slot);
            staged.cancel();
            return false;
        }
        if let Some(previous) = slot.replace(staged) {
            previous.cancel();
        }
        true
    }

    pub fn cancel(&self) {
        self.state.epoch.fetch_add(1, Ordering::AcqRel);
        if let Some(staged) = self.state.slot.lock().take() {
            staged.cancel();
        }
    }

    fn take(&self) -> Option<StagedProcessedDecoder> {
        self.state.slot.lock().take()
    }

    fn close(&self) {
        self.state.closed.store(true, Ordering::Release);
        self.cancel();
    }
}

/// 统一结束解码线程；panic 属于源错误，但仍需结束 source 迭代
fn finish_decode_thread(shared: &Shared, panicked: bool) {
    if panicked {
        shared.mark_decode_failed();
    }
    shared.mark_eof();
}

fn run_decode_safely(shared: &Shared, decode: impl FnOnce()) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(decode));
    finish_decode_thread(shared, result.is_err());
}

impl DecoderData {
    /// 在已有 reader 上 seek，失败时调用方应回退到完整 load
    ///
    /// seek 后两个重采样器要 flush 掉残留样本，否则播放/FFT会带上上一段尾巴
    pub fn seek(&mut self, position_secs: f64) -> bool {
        if let Some(handle) = &self.cancel_handle {
            handle.reset();
        }
        let cue_position_secs = self.cue_info.as_ref().map(|cue| {
            if cue.duration > 0.0 {
                position_secs.clamp(0.0, cue.duration)
            } else {
                position_secs.max(0.0)
            }
        });
        let target_secs = self
            .cue_info
            .as_ref()
            .zip(cue_position_secs)
            .map_or(position_secs, |(cue, position)| cue.start_time + position);
        let target = Duration::from_secs_f64(target_secs);
        if self.reader.seek(target, SeekMode::Accurate).is_err()
            && self.reader.seek(target, SeekMode::Coarse).is_err()
        {
            return false;
        }
        let _ = self.player_resampler.flush();
        let _ = self.fft_resampler.flush();
        if let Some(position) = cue_position_secs {
            self.cue_position_secs = position;
        }
        true
    }

    /// 获取网络中断句柄，恢复解码时绑定到新的共享状态
    pub fn cancel_handle(&self) -> Option<HttpCancelHandle> {
        self.cancel_handle.clone()
    }

    /// 输出设备格式变化后重建播放重采样器；FFT 分支仍保持固定双声道分析格式
    pub fn reconfigure_player_output(&mut self, sample_rate: u32, channels: u16) -> Result<()> {
        self.player_resampler = build_player_resampler(&self.reader, sample_rate, channels)?;
        Ok(())
    }
}

/// 启动解码线程，返回音频元数据和线程句柄
///
/// 线程结束时返回 `DecoderData`，调用方可通过 `handle.join()` 回收并复用于后续 seek，
/// 避免重建 ffmpeg_audio 上下文。
pub fn probe_metadata(
    source: &str,
    cover_cache_dir: Option<&str>,
    cancel_handle: HttpCancelHandle,
) -> Result<AudioMetadata> {
    media_probe::probe_metadata(source, cover_cache_dir, cancel_handle)
}

pub fn prepare_decode(
    source: &str,
    cover_cache_dir: Option<&str>,
    cancel_handle: HttpCancelHandle,
) -> Result<PreparedDecoder> {
    media_probe::prepare_media(source, cover_cache_dir, cancel_handle)
}

fn build_decoder_data(
    prepared: PreparedDecoder,
    target_rate: u32,
    target_channels: u16,
) -> Result<(AudioMetadata, DecoderData, Option<HttpCancelHandle>, f32)> {
    let PreparedMedia {
        reader,
        mut metadata,
        replay_gain_db,
        cancel_handle,
        cue_info,
    } = prepared;
    let (player_resampler, fft_resampler) =
        build_resamplers(&reader, target_rate, target_channels)?;
    metadata.sample_rate = target_rate;
    let normalization_gain = replay_gain_db.map(metadata::db_to_linear).unwrap_or(1.0);
    let data = DecoderData {
        reader,
        player_resampler,
        fft_resampler,
        cancel_handle: cancel_handle.clone(),
        cue_info,
        cue_position_secs: 0.0,
    };
    Ok((metadata, data, cancel_handle, normalization_gain))
}

pub fn prepare_processed_stage(
    source: &str,
    cover_cache_dir: Option<&str>,
    cancel_handle: HttpCancelHandle,
    target_rate: u32,
    target_channels: u16,
    generation: u64,
) -> Result<StagedProcessedDecoder> {
    let prepared = prepare_decode(source, cover_cache_dir, cancel_handle)?;
    anyhow::ensure!(
        prepared.original_channels() == target_channels,
        "processed gapless 下一音源声道数变化需要重新协商输出"
    );
    let (metadata, data, _cancel, normalization_gain) =
        build_decoder_data(prepared, target_rate, target_channels)?;
    anyhow::ensure!(
        metadata.bits_per_sample != 1,
        "processed gapless 不接受 Native DSD"
    );
    Ok(StagedProcessedDecoder {
        data,
        metadata,
        normalization_gain,
        generation,
    })
}

/// 按已经打开的输出流采样率启动解码，避免为探测音源信息重复打开网络源
pub fn start_prepared_decode(
    prepared: PreparedDecoder,
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) -> Result<(
    AudioMetadata,
    JoinHandle<DecoderData>,
    Option<HttpCancelHandle>,
    ProcessedStageHandle,
)> {
    let target_rate = shared.sample_rate();
    let (metadata, data, cancel_handle, normalization_gain) =
        build_decoder_data(prepared, target_rate, shared.channels())?;
    shared.set_normalization_gain(normalization_gain);
    shared.set_track_duration(metadata.duration_secs);
    if let Some(handle) = &cancel_handle {
        shared.bind_cancel_handle(handle.clone());
    }
    let stage_handle = ProcessedStageHandle::new();
    let handle = spawn_decode_chain(
        data,
        Arc::clone(&shared),
        equalizer,
        tempo,
        stage_handle.clone(),
    )?;

    Ok((metadata, handle, cancel_handle, stage_handle))
}

/// 用已有的 DecoderData 继续解码（seek 后复用）
pub fn resume_decode(
    data: DecoderData,
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) -> Result<(JoinHandle<DecoderData>, ProcessedStageHandle)> {
    if let Some(handle) = data.cancel_handle() {
        shared.bind_cancel_handle(handle);
    }
    let stage_handle = ProcessedStageHandle::new();
    let handle = spawn_decode_chain(data, shared, equalizer, tempo, stage_handle.clone())?;
    Ok((handle, stage_handle))
}

fn spawn_decode_chain(
    data: DecoderData,
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
    stage_handle: ProcessedStageHandle,
) -> Result<JoinHandle<DecoderData>> {
    thread::Builder::new()
        .name("audio-decoder".to_string())
        .spawn(move || {
            priority::boost_current_audio_thread("audio-decoder");
            let mut data = data;
            let dsp_shared = Arc::clone(&shared);
            let dsp_handle = thread::Builder::new()
                .name("audio-dsp".to_string())
                .spawn(move || run_dsp_safely(dsp_shared, equalizer, tempo));
            let Ok(dsp_handle) = dsp_handle else {
                shared.mark_decode_failed();
                shared.mark_output_eof();
                return data;
            };
            let mut next_boundary = None;
            loop {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_decoding_loop(&mut data, &shared, next_boundary.take());
                }));
                if result.is_err() {
                    shared.mark_decode_failed();
                    break;
                }
                if shared.is_stopping() || shared.is_decode_failed() {
                    break;
                }
                let Some(staged) = stage_handle.take() else {
                    break;
                };
                if let Some(handle) = staged.data.cancel_handle() {
                    shared.bind_cancel_handle(handle);
                }
                shared.set_normalization_gain(staged.normalization_gain);
                next_boundary = Some(ProcessedTrackBoundary {
                    generation: staged.generation,
                    duration_micros: (staged.metadata.duration_secs.max(0.0) * 1_000_000.0)
                        .round()
                        .clamp(0.0, u64::MAX as f64) as u64,
                });
                data = staged.data;
            }
            stage_handle.close();
            finish_decode_thread(&shared, false);
            if dsp_handle.join().is_err() {
                shared.mark_decode_failed();
                shared.mark_output_eof();
            }
            data
        })
        .context("启动解码线程失败")
        .with_audio_kind(AudioErrorKind::DecodeFailed)
}

fn process_audio_chunk(
    mut chunk: AudioChunk,
    equalizer: &Mutex<Equalizer>,
    tempo: &Mutex<StretchProcessor>,
    tempo_scratch: &mut Vec<f32>,
) -> AudioChunk {
    if chunk.player_samples.is_empty() {
        return chunk;
    }

    equalizer
        .lock()
        .process_interleaved(&mut chunk.player_samples);
    if tempo.lock().is_bypass() {
        return chunk;
    }

    tempo_scratch.clear();
    tempo.lock().process(&chunk.player_samples, tempo_scratch);
    std::mem::swap(&mut chunk.player_samples, tempo_scratch);
    chunk
}

fn run_dsp_loop(shared: &Shared, equalizer: &Mutex<Equalizer>, tempo: &Mutex<StretchProcessor>) {
    let mut tempo_scratch = shared.take_player_buffer();
    while let Some(chunk) = shared.pop_decoded() {
        let chunk = process_audio_chunk(chunk, equalizer, tempo, &mut tempo_scratch);
        shared.push_output(chunk);
        if shared.is_stopping() {
            break;
        }
    }
    shared.recycle_player_buffer(tempo_scratch);
}

fn run_dsp_safely(
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_dsp_loop(&shared, &equalizer, &tempo);
    }));
    if result.is_err() {
        shared.mark_decode_failed();
    }
    shared.mark_output_eof();
}

fn build_player_resampler(
    reader: &AudioReader,
    target_rate: u32,
    target_channels: u16,
) -> Result<Resampler> {
    let player_opts = ResampleOptions::new()
        .sample_rate(target_rate as i32)
        .channels(i32::from(target_channels))
        .format::<f32>();
    reader
        .build_resampler(player_opts)
        .with_context(|| "构建播放重采样器失败")
}

fn build_resamplers(
    reader: &AudioReader,
    target_rate: u32,
    target_channels: u16,
) -> Result<(Resampler, Resampler)> {
    let player_resampler = build_player_resampler(reader, target_rate, target_channels)?;

    let fft_opts = ResampleOptions::new()
        .sample_rate(FFT_TARGET_SAMPLE_RATE as i32)
        .channels(i32::from(FFT_CHANNELS))
        .format::<f32>();
    let fft_resampler = reader
        .build_resampler(fft_opts)
        .with_context(|| "构建 FFT 重采样器失败")?;

    Ok((player_resampler, fft_resampler))
}

fn cue_player_sample_limit(data: &DecoderData, sample_rate: u32, channels: u16) -> Option<u64> {
    let cue = data.cue_info.as_ref()?;
    if cue.duration <= 0.0 {
        return None;
    }
    let remaining_secs = (cue.duration - data.cue_position_secs).max(0.0);
    let frames = (remaining_secs * f64::from(sample_rate)).round() as u64;
    Some(frames.saturating_mul(u64::from(channels)))
}

fn apply_cue_sample_limit(
    player_samples: &mut Vec<f32>,
    fft_samples: &mut Vec<f32>,
    emitted_samples: &mut u64,
    max_samples: u64,
) -> bool {
    let original_player_len = player_samples.len();
    let keep = max_samples
        .saturating_sub(*emitted_samples)
        .min(original_player_len as u64) as usize;

    if keep < original_player_len {
        player_samples.truncate(keep);
        if keep == 0 {
            fft_samples.clear();
        } else {
            let fft_frames = fft_samples.len() / usize::from(FFT_CHANNELS);
            let keep_fft_frames = fft_frames.saturating_mul(keep) / original_player_len;
            fft_samples.truncate(keep_fft_frames * usize::from(FFT_CHANNELS));
        }
    }

    *emitted_samples = emitted_samples.saturating_add(keep as u64);
    *emitted_samples >= max_samples
}

/// 核心解码循环：每帧解码一次，使用复用缓冲分发到播放与 FFT 重采样器
fn run_decoding_loop(
    data: &mut DecoderData,
    shared: &Shared,
    mut track_boundary: Option<ProcessedTrackBoundary>,
) {
    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let has_replay_gain = (shared.normalization_gain() - 1.0).abs() > f32::EPSILON;
    let mut loudness = LoudnessAnalyzer::new(shared.sample_rate(), shared.channels());
    loudness.set_has_replay_gain(has_replay_gain);
    let max_player_samples = cue_player_sample_limit(data, shared.sample_rate(), shared.channels());
    let mut emitted_player_samples = 0_u64;

    // 用于日志诊断：记录是否曾成功解码过帧
    let mut had_success = false;

    loop {
        // 背压：缓冲区满时阻塞等待消费
        if !shared.wait_for_space() {
            return;
        }
        if max_player_samples.is_some_and(|max| emitted_player_samples >= max) {
            return;
        }

        match data.reader.receive_frame() {
            Ok(Some(frame)) => {
                // 1-to-N: 同一帧顺序喂两个重采样器
                if data.player_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("player resampler 处理失败，结束解码");
                    shared.mark_decode_failed();
                    return;
                }
                let mut player_samples = shared.take_player_buffer();
                player_samples.extend_from_slice(data.player_resampler.output_as::<f32>());

                if data.fft_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("fft resampler 处理失败，结束解码");
                    shared.recycle_player_buffer(player_samples);
                    shared.mark_decode_failed();
                    return;
                }
                let mut fft_samples = shared.take_fft_buffer();
                fft_samples.extend_from_slice(data.fft_resampler.output_as::<f32>());

                // 重采样可能还在攒样本，本轮没出数据就跳过
                if player_samples.is_empty() && fft_samples.is_empty() {
                    shared.recycle_player_buffer(player_samples);
                    shared.recycle_fft_buffer(fft_samples);
                    continue;
                }
                had_success = true;

                let reached_cue_limit = max_player_samples.is_some_and(|max| {
                    apply_cue_sample_limit(
                        &mut player_samples,
                        &mut fft_samples,
                        &mut emitted_player_samples,
                        max,
                    )
                });

                if shared.is_normalization_enabled() && !player_samples.is_empty() {
                    let gain = if has_replay_gain {
                        shared.normalization_gain()
                    } else {
                        loudness.process(&player_samples)
                    };
                    if (gain - 1.0).abs() > f32::EPSILON {
                        for s in &mut player_samples {
                            *s *= gain;
                        }
                    }
                }

                shared.push(AudioChunk {
                    source_sample_count: player_samples.len() as u64,
                    player_samples,
                    fft_samples,
                    track_boundary: track_boundary.take(),
                });
                if reached_cue_limit {
                    debug!("CUE 分轨播放达到精确边界，结束当前音轨解码");
                    return;
                }
            }
            Ok(None) | Err(AudioError::Eof) => {
                // EOF flush：把两个重采样器内部残留挤出来，否则最后几十毫秒丢
                let _ = data.player_resampler.process::<f32>(None);
                let _ = data.fft_resampler.process::<f32>(None);
                let mut player_samples = shared.take_player_buffer();
                player_samples.extend_from_slice(data.player_resampler.output_as::<f32>());
                let mut fft_samples = shared.take_fft_buffer();
                fft_samples.extend_from_slice(data.fft_resampler.output_as::<f32>());
                if let Some(max) = max_player_samples {
                    apply_cue_sample_limit(
                        &mut player_samples,
                        &mut fft_samples,
                        &mut emitted_player_samples,
                        max,
                    );
                }
                if !player_samples.is_empty() || !fft_samples.is_empty() {
                    shared.push(AudioChunk {
                        source_sample_count: player_samples.len() as u64,
                        player_samples,
                        fft_samples,
                        track_boundary: track_boundary.take(),
                    });
                } else {
                    shared.recycle_player_buffer(player_samples);
                    shared.recycle_fft_buffer(fft_samples);
                }
                return;
            }
            Err(e) => {
                // stop/切歌触发的 HTTP 取消不是源故障
                if shared.is_stopping() {
                    debug!(error = %e, "解码线程因停止信号退出");
                    return;
                }
                // 本地 File 的 io::Error 可能经 ffmpeg_audio read 回调映射为 AVERROR(EIO)
                let io_failure = match &e {
                    AudioError::Io(_) => true,
                    AudioError::FFmpeg(code, _) => *code == AVERROR_EIO,
                    _ => false,
                };
                // 统一标记 decode_failed：包括 IO 错误和 FFmpeg 数据错误
                // 长时间暂停后 HTTP 流断开重连、URL 过期等场景下 FFmpeg 会报
                // INVALIDDATA（非 EIO），但本质仍是数据源故障，需要标记以触发
                // SourceError 让 JS 重新解析播放地址
                // 尾部坏帧（FLAC ID3v1 / VBR 末帧）容忍由 position timer 的 3s
                // 阈值保障：mark_decode_failed 后若 position 接近末尾仍发 Ended
                shared.mark_decode_failed();
                debug!(error = %e, had_success, io_failure, "解码线程异常结束");
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::PopResult;
    use std::io::Cursor;

    fn mono_wav() -> Vec<u8> {
        let sample_rate = 48_000_u32;
        let frames = 1024_u32;
        let data_size = frames * 2;
        let mut bytes = Vec::with_capacity(44 + data_size as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        bytes.resize(44 + data_size as usize, 0);
        bytes
    }

    fn staged_decoder_for_test(generation: u64) -> StagedProcessedDecoder {
        let reader = AudioReader::new(Cursor::new(mono_wav())).unwrap();
        let (player_resampler, fft_resampler) = build_resamplers(&reader, 48_000, 1).unwrap();
        StagedProcessedDecoder {
            data: DecoderData {
                reader,
                player_resampler,
                fft_resampler,
                cancel_handle: None,
                cue_info: None,
                cue_position_secs: 0.0,
            },
            metadata: AudioMetadata {
                duration_secs: 1.0,
                sample_rate: 48_000,
                original_sample_rate: 48_000,
                channels: 1,
                ..Default::default()
            },
            normalization_gain: 1.0,
            generation,
        }
    }

    #[test]
    fn processed_stage_epoch_rejects_late_prepare_and_cancel_invalidates_slot() {
        let handle = ProcessedStageHandle::new();
        let first = handle.begin_stage();
        let second = handle.begin_stage();
        assert!(!handle.stage_if_current(first, staged_decoder_for_test(1)));
        assert!(handle.stage_if_current(second, staged_decoder_for_test(2)));
        assert_eq!(handle.take().unwrap().generation, 2);

        let third = handle.begin_stage();
        handle.cancel();
        assert!(!handle.stage_if_current(third, staged_decoder_for_test(3)));
        assert!(handle.take().is_none());
    }

    #[test]
    fn panic_marks_decode_failed_and_finishes_source() {
        let shared = Shared::new(48_000, DEFAULT_OUTPUT_CHANNELS);

        run_decode_safely(&shared, || panic!("模拟解码 panic"));

        assert!(shared.is_decode_failed());
        assert!(shared.pop_decoded().is_none());
        shared.mark_output_eof();
        assert!(matches!(shared.try_pop(), PopResult::Finished));
    }

    #[test]
    fn normal_completion_does_not_mark_decode_failed() {
        let shared = Shared::new(48_000, DEFAULT_OUTPUT_CHANNELS);

        run_decode_safely(&shared, || {});

        assert!(!shared.is_decode_failed());
        assert!(shared.pop_decoded().is_none());
        shared.mark_output_eof();
        assert!(matches!(shared.try_pop(), PopResult::Finished));
    }

    #[test]
    fn dsp_keeps_eq_gain_for_final_processed_output_stage() {
        let equalizer = Mutex::new(Equalizer::new(48_000, 2));
        equalizer.lock().set_enabled(true);
        equalizer.lock().set_preamp_db(12.0);
        let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
        let mut scratch = Vec::new();

        let processed = process_audio_chunk(
            AudioChunk {
                player_samples: vec![0.8, -0.8],
                fft_samples: Vec::new(),
                source_sample_count: 2,
                track_boundary: None,
            },
            &equalizer,
            &tempo,
            &mut scratch,
        );

        assert!(processed
            .player_samples
            .iter()
            .any(|sample| sample.abs() > 1.0));
    }

    #[test]
    fn tempo_changes_output_length_but_preserves_source_count() {
        let equalizer = Mutex::new(Equalizer::new(48_000, 2));
        let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
        tempo.lock().set_speed(2.0);
        let mut scratch = Vec::new();
        let input = vec![0.1; 4096];

        let processed = process_audio_chunk(
            AudioChunk {
                source_sample_count: input.len() as u64,
                player_samples: input,
                fft_samples: Vec::new(),
                track_boundary: None,
            },
            &equalizer,
            &tempo,
            &mut scratch,
        );

        assert_eq!(processed.source_sample_count, 4096);
        assert_eq!(processed.player_samples.len(), 2048);
    }

    #[test]
    fn playback_and_fft_resamplers_use_independent_channel_counts() {
        let mut reader = AudioReader::new(Cursor::new(mono_wav())).unwrap();
        assert_eq!(reader.source_info().channels, 1);
        let (mut player_resampler, mut fft_resampler) =
            build_resamplers(&reader, 48_000, 6).unwrap();
        let frame = reader.receive_frame().unwrap().unwrap();

        player_resampler.process::<f32>(Some(&frame)).unwrap();
        fft_resampler.process::<f32>(Some(&frame)).unwrap();

        let player_samples = player_resampler.output_as::<f32>();
        let fft_samples = fft_resampler.output_as::<f32>();
        assert!(!player_samples.is_empty());
        assert!(!fft_samples.is_empty());
        assert_eq!(player_samples.len() % 6, 0);
        assert_eq!(fft_samples.len() % usize::from(FFT_CHANNELS), 0);
    }

    #[test]
    fn cue_limit_uses_remaining_duration_after_seek() {
        let reader = AudioReader::new(Cursor::new(mono_wav())).unwrap();
        let (player_resampler, fft_resampler) = build_resamplers(&reader, 48_000, 2).unwrap();
        let data = DecoderData {
            reader,
            player_resampler,
            fft_resampler,
            cancel_handle: None,
            cue_info: Some(CueVirtualInfo {
                physical_path: "album.wav".to_string(),
                start_time: 30.0,
                duration: 10.0,
                track_num: 2,
            }),
            cue_position_secs: 4.0,
        };

        assert_eq!(cue_player_sample_limit(&data, 48_000, 2), Some(576_000));
    }

    #[test]
    fn cue_limit_truncates_audio_and_fft_at_the_same_frame_fraction() {
        let mut player_samples = vec![0.0; 200];
        let mut fft_samples = vec![0.0; 100];
        let mut emitted = 900;

        assert!(apply_cue_sample_limit(
            &mut player_samples,
            &mut fft_samples,
            &mut emitted,
            1_000,
        ));
        assert_eq!(player_samples.len(), 100);
        assert_eq!(fft_samples.len(), 50);
        assert_eq!(emitted, 1_000);
    }
}
