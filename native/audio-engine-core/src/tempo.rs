//! 变速 / 变调（Signalsmith Stretch 算法）
//!
//! 接入位置：decoder 后台 DSP pipeline；最终输出由 ALSA processed writer 消费。
//! 输入/输出都是交错 f32 多声道样本。
//!
//! 参数：
//! - `speed`：[0.5, 2.0]，1.0 = 原速；通过 `process` 输入/输出长度比实现
//! - `pitch_semitones`：[-12, 12]，0 = 不变调；仅在 `pitch_sync=true` 下生效
//! - `pitch_sync`：true = 变速保音调（默认）；false = 变速变调（老式磁带），
//!   此时 `effective_transpose = 12·log2(speed)`，UI 上 pitch 滑块 disable

use signalsmith_stretch::Stretch;

/// "约等于零"的浮点比较阈值。
///
/// `f32::EPSILON ≈ 1.19e-7` 对 IPC 来回（JS f64 → Rust f32）转换中的 ULP 抖动太敏感，
/// 容易把"应当 bypass"的 1.0 误判成"非 bypass"。UI 步进 0.05，1e-4 既能容忍抖动，
/// 又不会和任何真实档位冲突。
const FLOAT_EQ_EPS: f32 = 1e-4;

pub struct StretchProcessor {
    stretch: Stretch,
    channels: u16,
    /// 当前 stretch 内核构建所用的采样率
    sample_rate: u32,
    speed: f32,
    pitch_semitones: i8,
    pitch_sync: bool,
    /// 当前已下发到 stretch 的有效 transpose（用于减少冗余的 set 调用）
    applied_transpose: f32,
    active: bool,
    discard_frames: usize,
    target_output_frames: f64,
    requested_frames: usize,
    emitted_frames: usize,
    last_process_speed: f32,
}

impl StretchProcessor {
    /// 构造一个默认 1.0× / 0 半音 / sync=ON 的处理器，初始即 bypass
    pub fn new(channels: u16, sample_rate: u32) -> Self {
        let stretch = Stretch::preset_default(channels as u32, sample_rate);
        Self {
            stretch,
            channels,
            sample_rate,
            speed: 1.0,
            pitch_semitones: 0,
            pitch_sync: true,
            applied_transpose: 0.0,
            active: false,
            discard_frames: 0,
            target_output_frames: 0.0,
            requested_frames: 0,
            emitted_frames: 0,
            last_process_speed: 1.0,
        }
    }

    /// 更新输出格式；采样率或声道数改变后必须重建 stretch 内核
    pub fn set_output_format(&mut self, sample_rate: u32, channels: u16) {
        if sample_rate == self.sample_rate && channels == self.channels {
            return;
        }
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.stretch = Stretch::preset_default(u32::from(channels), sample_rate);
        self.clear_stream_state();
        // 新内核 transpose 归零，强制按当前参数重新下发
        self.applied_transpose = 0.0;
        self.sync_transpose_to_stretch();
    }

    /// 1.0 速度 + 当前模式下 transpose 为 0：bypass，可走 passthrough
    pub fn is_bypass(&self) -> bool {
        (self.speed - 1.0).abs() < FLOAT_EQ_EPS && self.effective_transpose().abs() < FLOAT_EQ_EPS
    }

    /// sync=ON：transpose = pitch_semitones（独立调音调）
    /// sync=OFF：transpose = 12·log2(speed)（音调跟着速度走）
    fn effective_transpose(&self) -> f32 {
        if self.pitch_sync {
            self.pitch_semitones as f32
        } else {
            12.0 * self.speed.log2()
        }
    }

    fn sync_transpose_to_stretch(&mut self) {
        let target = self.effective_transpose();
        if (target - self.applied_transpose).abs() > FLOAT_EQ_EPS {
            self.stretch.set_transpose_factor_semitones(target, None);
            self.applied_transpose = target;
        }
    }

    /// 设置播放速度，自动 clamp 到 [0.5, 2.0]。
    /// 非有限值（NaN/±Inf）降级为 1.0，避免 NaN 经 log2/process 传播导致整段静音
    pub fn set_speed(&mut self, speed: f32) {
        let v = if speed.is_finite() { speed } else { 1.0 };
        self.speed = v.clamp(0.5, 2.0);
    }

    /// 设置音调偏移（半音），自动 clamp 到 [-12, 12]。
    /// sync=OFF 时只保存参数，等切回 sync=ON 时在 DSP 块边界生效。
    pub fn set_pitch(&mut self, semitones: i8) {
        self.pitch_semitones = semitones.clamp(-12, 12);
    }

    /// 切换"音调同步"开关，下一个 DSP 块按新公式更新 transpose
    pub fn set_pitch_sync(&mut self, sync: bool) {
        self.pitch_sync = sync;
    }

    pub fn speed(&self) -> f32 {
        self.speed
    }

    pub fn pitch(&self) -> i8 {
        self.pitch_semitones
    }

    pub fn pitch_sync(&self) -> bool {
        self.pitch_sync
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// 切歌 / seek 时重置处理器状态，避免拼接处出现瞬态
    pub fn reset(&mut self) {
        self.stretch.reset();
        self.clear_stream_state();
    }

    fn clear_stream_state(&mut self) {
        self.active = false;
        self.discard_frames = 0;
        self.target_output_frames = 0.0;
        self.requested_frames = 0;
        self.emitted_frames = 0;
        self.last_process_speed = 1.0;
    }

    pub fn has_pending_output(&self) -> bool {
        self.active
    }

    pub fn planned_frames(&self, input_samples: usize) -> usize {
        let input_frames = input_samples / usize::from(self.channels);
        (self.target_output_frames + input_frames as f64 / f64::from(self.speed)).round() as usize
            - self.requested_frames
    }

    /// 处理一块交错 f32 样本，写入 `output`。
    /// bypass 时直接 extend，零开销。
    pub fn process(&mut self, input: &[f32], output: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        if self.is_bypass() {
            output.extend_from_slice(input);
            return;
        }

        let channels = self.channels as usize;
        let input_frames = input.len() / channels;
        if input_frames == 0 {
            return;
        }

        // 输出帧数 = 输入帧数 / speed（speed > 1 → 输出更短即更快）
        let output_frames = self.planned_frames(input.len());
        if !self.active {
            self.active = true;
            // reset 后的处理时间位于首样本之前；丢掉预热输出，在 EOF 补回等长尾部。
            self.discard_frames = self.stretch.output_latency()
                + ((self.stretch.input_latency() as f64) / f64::from(self.speed)).ceil() as usize;
        }
        // 控制线程只改请求值；算法参数在当前 DSP 块边界生效。
        self.sync_transpose_to_stretch();
        self.last_process_speed = self.speed;
        self.target_output_frames += input_frames as f64 / f64::from(self.speed);
        self.requested_frames = self.requested_frames.saturating_add(output_frames);

        let start = output.len();
        output.resize(start + output_frames * channels, 0.0);
        self.stretch.process(input, &mut output[start..]);
        let discard = self.discard_frames.min(output_frames);
        if discard > 0 {
            output.copy_within(start + discard * channels.., start);
            output.truncate(start + (output_frames - discard) * channels);
            self.discard_frames -= discard;
        }
        self.emitted_frames += output_frames - discard;
    }

    /// 用静音推进输入窗口，并取回被算法延迟的有效曲尾。
    pub fn finish(&mut self, output: &mut Vec<f32>) {
        output.clear();
        if !self.active {
            return;
        }
        let channels = usize::from(self.channels);
        let input_latency = self.stretch.input_latency();
        let padding_frames =
            ((input_latency as f64) / f64::from(self.last_process_speed)).ceil() as usize;
        let padding = vec![0.0; input_latency * channels];
        output.resize(padding_frames * channels, 0.0);
        self.stretch.process(&padding, output.as_mut_slice());
        let needed = self
            .discard_frames
            .saturating_add(self.requested_frames - self.emitted_frames)
            .saturating_sub(padding_frames);
        let flush_frames = self.stretch.output_latency().max(needed);
        let start = output.len();
        output.resize(start + flush_frames * channels, 0.0);
        self.stretch.flush(&mut output[start..]);

        let discard = self.discard_frames.min(output.len() / channels);
        output.copy_within(discard * channels.., 0);
        output.truncate((output.len() / channels - discard) * channels);
        let remaining = self.requested_frames - self.emitted_frames;
        output.truncate(remaining * channels);
        self.stretch.reset();
        self.clear_stream_state();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_bypass() {
        let p = StretchProcessor::new(2, 48000);
        assert!(p.is_bypass());
    }

    #[test]
    fn sync_on_pitch_only_changes_transpose() {
        let mut p = StretchProcessor::new(2, 48000);
        p.set_pitch(5);
        assert!(!p.is_bypass());
        assert!((p.effective_transpose() - 5.0).abs() < 1e-6);
    }

    #[test]
    fn sync_off_speed_drives_transpose() {
        let mut p = StretchProcessor::new(2, 48000);
        p.set_pitch_sync(false);
        p.set_speed(2.0);
        // speed=2 → transpose ≈ 12 半音（升 1 个八度）
        assert!((p.effective_transpose() - 12.0).abs() < 1e-3);
    }

    #[test]
    fn bypass_passthrough_preserves_samples() {
        let mut p = StretchProcessor::new(2, 48000);
        let input = vec![0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
        let mut output = Vec::new();
        p.process(&input, &mut output);
        assert_eq!(output, input);
    }

    #[test]
    fn rebuilds_for_multichannel_output() {
        let mut p = StretchProcessor::new(2, 48_000);
        p.set_output_format(96_000, 6);

        assert_eq!(p.channels, 6);
        assert_eq!(p.sample_rate, 96_000);
    }

    #[test]
    fn pitch_shift_keeps_short_track_tail_and_exact_output_length() {
        let mut p = StretchProcessor::new(2, 48_000);
        p.set_pitch(5);
        let mut input = vec![0.0_f32; 4_800 * 2];
        for frame in (0..1_000).chain(3_800..4_800) {
            let sample = (frame as f32 * 0.13).sin() * 0.5;
            input[frame * 2] = sample;
            input[frame * 2 + 1] = sample;
        }

        let mut output = Vec::new();
        for chunk in input.chunks(512) {
            p.process(chunk, &mut output);
        }
        let before_finish = output.len();
        let mut tail = Vec::new();
        p.finish(&mut tail);
        assert!(before_finish < input.len());
        assert!(tail.iter().any(|sample| sample.abs() > 0.01));
        output.extend_from_slice(&tail);
        assert_eq!(output.len(), input.len());
        assert!(output[..1_000 * 2].iter().any(|sample| sample.abs() > 0.01));
        assert!(output[3_800 * 2..].iter().any(|sample| sample.abs() > 0.01));
    }

    #[test]
    fn fractional_speed_does_not_accumulate_chunk_rounding_drift() {
        let mut p = StretchProcessor::new(2, 48_000);
        p.set_speed(1.15);
        let input = vec![0.1_f32; 257 * 2];
        let mut output = Vec::new();
        for _ in 0..128 {
            p.process(&input, &mut output);
        }
        let mut tail = Vec::new();
        p.finish(&mut tail);
        output.extend_from_slice(&tail);

        let expected_frames = (257.0_f64 * 128.0 / 1.15_f64).round() as usize;
        assert_eq!(output.len(), expected_frames * 2);
    }
}
