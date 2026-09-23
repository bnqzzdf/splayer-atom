use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use ffmpeg_audio::HttpCancelHandle;
use parking_lot::{Condvar, Mutex};

use crate::alsa::format::AlsaPcmFormat;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessedTrackBoundary {
    pub generation: u64,
    pub duration_micros: u64,
}

/// 解码后的 PCM 音频数据块
pub struct AudioChunk {
    /// 交错排列的 f32 播放样本（L R L R ...）
    pub player_samples: Vec<f32>,
    /// tempo 处理前的源样本数，用于保持变速时播放位置准确
    pub source_sample_count: u64,
    /// processed gapless 下一首的首个有效输出块标记；只由 writer 在 DAC-side 提交。
    pub track_boundary: Option<ProcessedTrackBoundary>,
}

/// producer 完成 DSP、最终增益与量化后交给 ALSA writer 的字节块。
pub struct PreparedPcmChunk {
    pub bytes: Vec<u8>,
    pub frames: u64,
    pub source_sample_count: u64,
    pub track_boundary: Option<ProcessedTrackBoundary>,
}

/// 非阻塞弹出缓冲区的结果
pub enum PopResult {
    Chunk(PreparedPcmChunk),
    Pending,
    Finished,
}

/// 解码线程与播放迭代器之间的共享状态
pub struct Shared {
    decoded_buffer: Mutex<VecDeque<AudioChunk>>,
    decoded_condvar: Condvar,
    output_buffer: Mutex<VecDeque<PreparedPcmChunk>>,
    output_condvar: Condvar,
    player_buffer_pool: Mutex<Vec<Vec<f32>>>,
    packed_buffer_pool: Mutex<Vec<Vec<u8>>>,
    processed_format: Mutex<AlsaPcmFormat>,
    processed_volume: AtomicU32,
    clipping_protection: AtomicBool,
    decode_eof: AtomicBool,
    output_eof: AtomicBool,
    is_stopping: AtomicBool,
    /// 已被输出回调消费的交错采样数（包含所有声道）
    samples_consumed: AtomicU64,
    /// 当前曲目在累计 source sample 时间线中的起点（交错样本数）。
    track_base_samples: AtomicU64,
    /// 当前曲目时长，由 load 或 DAC-side gapless boundary 更新。
    track_duration_micros: AtomicU64,
    /// DAC-side 已提交的 processed gapless 边界代次。
    track_transition_count: AtomicU64,
    track_boundary_generation: AtomicU64,
    /// 输出采样率（创建时确定，不可变）
    sample_rate: u32,
    /// 输出声道数（创建时确定，不可变）
    channels: u16,
    /// 所有数据已被 ALSA writer 真正 drain 完毕
    all_consumed: AtomicBool,
    /// 解码线程因读取失败（网络中断 / URL 失效）中止，区别于正常 EOF
    decode_failed: AtomicBool,
    /// 音量归一化增益因子（线性值，1.0 = 无增益）
    /// 使用 AtomicU32 + f32::to_bits/from_bits 实现原子 f32
    normalization_gain: AtomicU32,
    /// 音量归一化开关
    normalization_enabled: AtomicBool,
    /// 关联的网络中断句柄（由 decoder 在启动解码前注入）
    /// stop() 触发时中断读取和重试等待，seek 前可重置
    cancel_handle: Mutex<Option<HttpCancelHandle>>,
}

/// 共享缓冲区最大容量（背压阈值）
pub const FRAME_BUFFER_CAPACITY: usize = 192;

/// DSP 后缓冲只保留少量块，保证 EQ/tempo 参数更新能快速生效
const OUTPUT_BUFFER_CAPACITY: usize = 4;

/// 复用池上限覆盖解码队列、输出队列和两个线程的在手缓冲
const BUFFER_POOL_CAPACITY: usize = FRAME_BUFFER_CAPACITY + OUTPUT_BUFFER_CAPACITY + 4;

impl Shared {
    pub fn new(sample_rate: u32, channels: u16) -> Arc<Self> {
        assert!(
            sample_rate > 0 && channels > 0,
            "sample_rate/channels 必须为正"
        );
        Arc::new(Self {
            decoded_buffer: Mutex::new(VecDeque::with_capacity(FRAME_BUFFER_CAPACITY)),
            decoded_condvar: Condvar::new(),
            output_buffer: Mutex::new(VecDeque::with_capacity(OUTPUT_BUFFER_CAPACITY)),
            output_condvar: Condvar::new(),
            player_buffer_pool: Mutex::new(Vec::with_capacity(BUFFER_POOL_CAPACITY)),
            packed_buffer_pool: Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_CAPACITY + 2)),
            processed_format: Mutex::new(AlsaPcmFormat::F32Le),
            processed_volume: AtomicU32::new(1.0_f32.to_bits()),
            clipping_protection: AtomicBool::new(false),
            decode_eof: AtomicBool::new(false),
            output_eof: AtomicBool::new(false),
            is_stopping: AtomicBool::new(false),
            samples_consumed: AtomicU64::new(0),
            track_base_samples: AtomicU64::new(0),
            track_duration_micros: AtomicU64::new(0),
            track_transition_count: AtomicU64::new(0),
            track_boundary_generation: AtomicU64::new(0),
            sample_rate,
            channels,
            all_consumed: AtomicBool::new(false),
            decode_failed: AtomicBool::new(false),
            normalization_gain: AtomicU32::new(1.0_f32.to_bits()),
            normalization_enabled: AtomicBool::new(false),
            cancel_handle: Mutex::new(None),
        })
    }

    /// 绑定网络中断句柄，之后调用 stop() 会中断 HTTP IO
    pub fn bind_cancel_handle(&self, cancel_handle: HttpCancelHandle) {
        *self.cancel_handle.lock() = Some(cancel_handle);
    }

    /// 设置归一化增益因子（线性值）
    pub fn set_normalization_gain(&self, gain: f32) {
        self.normalization_gain
            .store(gain.to_bits(), Ordering::Relaxed);
    }

    /// 输出采样率
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// 播放输出声道数
    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// 设置归一化开关
    pub fn set_normalization_enabled(&self, enabled: bool) {
        self.normalization_enabled.store(enabled, Ordering::Relaxed);
    }

    /// 归一化是否启用
    pub fn is_normalization_enabled(&self) -> bool {
        self.normalization_enabled.load(Ordering::Relaxed)
    }

    /// 获取原始增益值（不考虑开关）
    pub fn normalization_gain(&self) -> f32 {
        f32::from_bits(self.normalization_gain.load(Ordering::Relaxed))
    }

    /// 获取可复用的播放样本缓冲
    pub fn take_player_buffer(&self) -> Vec<f32> {
        self.player_buffer_pool.lock().pop().unwrap_or_default()
    }

    /// 归还播放样本缓冲；池满时直接释放以保持内存有界
    pub fn recycle_player_buffer(&self, mut buffer: Vec<f32>) {
        buffer.clear();
        let mut pool = self.player_buffer_pool.lock();
        if pool.len() < BUFFER_POOL_CAPACITY {
            pool.push(buffer);
        }
    }

    /// 输出配置在解码/DSP 线程启动前提交；运行中只更新音量与保护开关。
    pub fn configure_processed_output(
        &self,
        format: AlsaPcmFormat,
        volume: f32,
        clipping_protection: bool,
    ) {
        *self.processed_format.lock() = format;
        self.set_processed_volume(volume);
        self.set_clipping_protection(clipping_protection);
    }

    pub fn processed_format(&self) -> AlsaPcmFormat {
        *self.processed_format.lock()
    }

    pub fn set_processed_volume(&self, volume: f32) {
        self.processed_volume
            .store(volume.to_bits(), Ordering::Release);
    }

    pub fn processed_volume(&self) -> f32 {
        f32::from_bits(self.processed_volume.load(Ordering::Acquire))
    }

    pub fn set_clipping_protection(&self, enabled: bool) {
        self.clipping_protection.store(enabled, Ordering::Release);
    }

    pub fn clipping_protection(&self) -> bool {
        self.clipping_protection.load(Ordering::Acquire)
    }

    pub fn take_packed_buffer(&self) -> Vec<u8> {
        self.packed_buffer_pool.lock().pop().unwrap_or_default()
    }

    pub fn recycle_packed_buffer(&self, mut buffer: Vec<u8>) {
        buffer.clear();
        let mut pool = self.packed_buffer_pool.lock();
        if pool.len() < OUTPUT_BUFFER_CAPACITY + 2 {
            pool.push(buffer);
        }
    }

    /// 兼容旧测试/辅助路径的增量消费计数；正式 ALSA processed writer 使用 `set_consumed_samples`。
    pub fn advance_consumed(&self, count: u64) {
        self.samples_consumed.fetch_add(count, Ordering::Relaxed);
    }

    /// ALSA processed writer 以 DAC 侧 `submitted - delay` 回推源时间后更新播放位置。
    /// 与旧 callback 的“取块即消费”不同，这里允许直接设置单调累计值。
    pub fn set_consumed_samples(&self, count: u64) {
        let mut current = self.samples_consumed.load(Ordering::Relaxed);
        while count > current {
            match self.samples_consumed.compare_exchange_weak(
                current,
                count,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => current = actual,
            }
        }
    }

    /// 已消费采样的原始计数（用于停滞检测，不做单位换算）
    pub fn samples_consumed_count(&self) -> u64 {
        self.samples_consumed.load(Ordering::Relaxed)
    }

    pub fn set_track_duration(&self, duration_secs: f64) {
        let micros = (duration_secs.max(0.0) * 1_000_000.0)
            .round()
            .clamp(0.0, u64::MAX as f64) as u64;
        self.track_duration_micros.store(micros, Ordering::Release);
    }

    pub fn track_duration(&self) -> f64 {
        self.track_duration_micros.load(Ordering::Acquire) as f64 / 1_000_000.0
    }

    pub fn track_transition_count(&self) -> u64 {
        self.track_transition_count.load(Ordering::Acquire)
    }

    pub fn track_boundary_generation(&self) -> u64 {
        self.track_boundary_generation.load(Ordering::Acquire)
    }

    pub fn commit_track_boundary(&self, source_sample_base: u64, boundary: ProcessedTrackBoundary) {
        self.track_base_samples
            .store(source_sample_base, Ordering::Release);
        self.track_duration_micros
            .store(boundary.duration_micros, Ordering::Release);
        self.track_boundary_generation
            .store(boundary.generation, Ordering::Release);
        self.track_transition_count.fetch_add(1, Ordering::AcqRel);
    }

    /// 缓冲区是否为空（true 表示解码 underrun，sink 不消费可能是正常等待数据）
    pub fn is_buffer_empty(&self) -> bool {
        self.output_buffer.lock().is_empty()
    }

    /// 标记所有数据已被真正播放/drain 完毕
    /// stop 引发的迭代结束不算播放完成，否则 position timer 在停止窗口期
    /// 会把切歌/停止误报成 Ended，导致前端队列跳两首
    pub fn mark_all_consumed(&self) {
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        self.all_consumed.store(true, Ordering::Release);
    }

    /// 是否已收到停止信号
    pub fn is_stopping(&self) -> bool {
        self.is_stopping.load(Ordering::Acquire)
    }

    /// 检查是否所有数据已被输出回调消费完毕
    pub fn is_all_consumed(&self) -> bool {
        self.all_consumed.load(Ordering::Acquire)
    }

    /// 标记解码因读取失败中止（网络中断 / URL 失效）
    pub fn mark_decode_failed(&self) {
        self.decode_failed.store(true, Ordering::Release);
    }

    /// 解码是否因读取失败中止
    pub fn is_decode_failed(&self) -> bool {
        self.decode_failed.load(Ordering::Acquire)
    }

    /// 基于实际消费采样数的精确播放位置（秒）
    pub fn consumed_position(&self) -> f64 {
        let samples = self.samples_consumed.load(Ordering::Relaxed);
        let base = self.track_base_samples.load(Ordering::Acquire);
        samples.saturating_sub(base) as f64 / self.sample_rate as f64 / self.channels as f64
    }

    /// 阻塞等待缓冲区有空间或收到停止信号，返回 false 表示应停止
    pub fn wait_for_space(&self) -> bool {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.len() >= FRAME_BUFFER_CAPACITY
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        !self.is_stopping.load(Ordering::Acquire) && !self.output_eof.load(Ordering::Acquire)
    }

    /// 推入数据块，缓冲区满时阻塞等待（背压）
    pub fn push(&self, chunk: AudioChunk) {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.len() >= FRAME_BUFFER_CAPACITY
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        if self.is_stopping.load(Ordering::Acquire) || self.output_eof.load(Ordering::Acquire) {
            return;
        }
        buffer.push_back(chunk);
        self.decoded_condvar.notify_one();
    }

    /// 阻塞获取待处理块；解码结束且缓冲耗尽时返回 None
    pub fn pop_decoded(&self) -> Option<AudioChunk> {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.is_empty()
            && !self.decode_eof.load(Ordering::Acquire)
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        let chunk = buffer.pop_front();
        if chunk.is_some() {
            self.decoded_condvar.notify_one();
        }
        chunk
    }

    /// 推入 DSP 后的数据块，保持小容量背压
    pub fn push_output(&self, chunk: PreparedPcmChunk) {
        let mut buffer = self.output_buffer.lock();
        while buffer.len() >= OUTPUT_BUFFER_CAPACITY && !self.is_stopping.load(Ordering::Acquire) {
            self.output_condvar.wait(&mut buffer);
        }
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        buffer.push_back(chunk);
        self.output_condvar.notify_one();
    }

    /// 非阻塞弹出数据块，供实时输出线程避免在音频回调链路里等待解码线程
    pub fn try_pop(&self) -> PopResult {
        let mut buffer = self.output_buffer.lock();
        if let Some(chunk) = buffer.pop_front() {
            self.output_condvar.notify_one();
            return PopResult::Chunk(chunk);
        }
        if self.output_eof.load(Ordering::Acquire) || self.is_stopping.load(Ordering::Acquire) {
            PopResult::Finished
        } else {
            PopResult::Pending
        }
    }

    /// 标记解码完成
    pub fn mark_eof(&self) {
        self.decode_eof.store(true, Ordering::Release);
        self.decoded_condvar.notify_all();
    }

    /// 标记 DSP 已处理完全部输出
    pub fn mark_output_eof(&self) {
        self.output_eof.store(true, Ordering::Release);
        self.decoded_condvar.notify_all();
        self.output_condvar.notify_all();
    }

    /// 发出停止信号，唤醒双方
    /// 同时取消网络请求，让阻塞中的 HTTP IO 尽快返回
    pub fn stop(&self) {
        self.is_stopping.store(true, Ordering::Release);
        if let Some(handle) = self.cancel_handle.lock().as_ref() {
            handle.cancel();
        }
        self.decoded_condvar.notify_all();
        self.output_condvar.notify_all();
    }

    /// 清空缓冲区并释放内存（stop 后调用，避免 AudioChunk 在 Arc 引用存活期间持续占用内存）
    pub fn drain_buffer(&self) {
        let mut decoded = self.decoded_buffer.lock();
        let decoded_chunks = std::mem::take(&mut *decoded);
        decoded.shrink_to_fit();
        drop(decoded);
        let mut output = self.output_buffer.lock();
        let output_chunks = std::mem::take(&mut *output);
        output.shrink_to_fit();
        drop(output);
        for chunk in decoded_chunks {
            self.recycle_player_buffer(chunk.player_samples);
        }
        for chunk in output_chunks {
            self.recycle_packed_buffer(chunk.bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_buffer_pools_are_bounded() {
        let shared = Shared::new(48_000, 2);

        for _ in 0..(BUFFER_POOL_CAPACITY + 20) {
            shared.recycle_player_buffer(Vec::with_capacity(16));
        }

        assert_eq!(shared.player_buffer_pool.lock().len(), BUFFER_POOL_CAPACITY);
    }

    #[test]
    fn processed_track_boundary_resets_visible_position_without_rewinding_total_consumed() {
        let shared = Shared::new(48_000, 2);
        shared.set_track_duration(5.0);
        shared.set_consumed_samples(96_000);
        assert!((shared.consumed_position() - 1.0).abs() < f64::EPSILON);

        shared.commit_track_boundary(
            96_000,
            ProcessedTrackBoundary {
                generation: 7,
                duration_micros: 3_000_000,
            },
        );
        assert_eq!(shared.samples_consumed_count(), 96_000);
        assert_eq!(shared.consumed_position(), 0.0);
        assert_eq!(shared.track_transition_count(), 1);
        assert_eq!(shared.track_boundary_generation(), 7);
        assert_eq!(shared.track_duration(), 3.0);
    }
}
