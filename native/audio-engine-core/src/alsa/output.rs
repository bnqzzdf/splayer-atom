use std::ffi::CString;
use std::ptr;

use alsa::pcm::{Access, HwParams};
use alsa::{Direction, ValueOr, PCM};
use anyhow::{anyhow, ensure, Context, Result};

use super::device::AlsaHwEndpoint;
use super::format::{direct_pcm_candidates, AlsaPcmFormat};
use crate::direct_pcm::{DirectPcmFormat, DirectPcmSampleFormat};

const TARGET_PERIOD_MS: u32 = 10;
/// 200ms 给直通路径留出调度抖动余量（直通 write_all 不做 XRUN 恢复）；播放位置已扣除 ALSA delay。
const TARGET_BUFFER_MS: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AlsaPcmConfig {
    pub format: AlsaPcmFormat,
    pub sample_rate: u32,
    pub channels: u16,
    pub significant_bits: u8,
    pub period_frames: u64,
    pub buffer_frames: u64,
    pub can_pause: bool,
}

/// 已完成 HW format/rate/channels/sbits 与缓冲协商的 PCM handle。
pub struct AlsaPcmHandle {
    pcm: PCM,
    config: AlsaPcmConfig,
}

impl AlsaPcmHandle {
    pub fn pcm(&self) -> &PCM {
        &self.pcm
    }

    pub fn config(&self) -> AlsaPcmConfig {
        self.config
    }

    pub(crate) fn into_parts(self) -> (PCM, AlsaPcmConfig) {
        (self.pcm, self.config)
    }
}

/// 打开真实 `hw:` PCM，并按 strict PCM 候选做联合参数协商。
///
/// ALSA rate resample 显式关闭；format/rate/channels 任一读回不一致都失败。
pub fn open_pcm_hw(endpoint: &AlsaHwEndpoint, source: DirectPcmFormat) -> Result<AlsaPcmHandle> {
    let candidates = direct_pcm_candidates(source)?;
    let mut last_error = None;

    for candidate in candidates {
        let significant_bits = if source.sample_format == DirectPcmSampleFormat::Float32 {
            candidate.significant_bits()
        } else {
            match query_significant_bits(endpoint, source, candidate) {
                Ok(value) => value,
                Err(error) => {
                    last_error = Some(error);
                    continue;
                }
            }
        };
        let pcm_name = endpoint.pcm_name();
        let pcm = match PCM::new(&pcm_name, Direction::Playback, true) {
            Ok(value) => value,
            Err(error) => {
                last_error =
                    Some(anyhow!(error).context(format!("打开 ALSA HW PCM 失败: {pcm_name}")));
                continue;
            }
        };
        match configure_candidate(&pcm, source, candidate, significant_bits) {
            Ok(config) => return Ok(AlsaPcmHandle { pcm, config }),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("ALSA HW 没有可用的 PCM 格式候选")))
}

/// 打开 processed PCM 的真实 `hw:` endpoint。
///
/// 声道数保持源语义不变；当前 caller 只允许 mono/stereo，避免 `ffmpeg_audio` 仅按声道数
/// 重建 default channel layout 时把未知 multichannel layout 隐式重排。优先源采样率，硬件
/// 不支持时由 `rate_near` 选择最接近的真实 HW rate；ALSA 自身 resampler 始终关闭。
pub fn open_processed_pcm_hw(
    endpoint: &AlsaHwEndpoint,
    requested_rate: u32,
    channels: u16,
) -> Result<AlsaPcmHandle> {
    ensure!(requested_rate > 0, "processed PCM 请求采样率无效");
    ensure!(channels > 0, "processed PCM 声道数无效");
    let mut last_error = None;
    for candidate in [
        AlsaPcmFormat::F32Le,
        AlsaPcmFormat::S32Le,
        AlsaPcmFormat::S24_3Le,
        AlsaPcmFormat::S24Le,
        AlsaPcmFormat::S16Le,
    ] {
        let pcm_name = endpoint.pcm_name();
        let pcm = match PCM::new(&pcm_name, Direction::Playback, true) {
            Ok(value) => value,
            Err(error) => {
                last_error = Some(
                    anyhow!(error).context(format!("打开 ALSA processed PCM 失败: {pcm_name}")),
                );
                continue;
            }
        };
        match configure_processed_candidate(&pcm, requested_rate, channels, candidate) {
            Ok(config) => return Ok(AlsaPcmHandle { pcm, config }),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("ALSA HW 没有可用 processed PCM 格式")))
}

fn configure_processed_candidate(
    pcm: &PCM,
    requested_rate: u32,
    channels: u16,
    candidate: AlsaPcmFormat,
) -> Result<AlsaPcmConfig> {
    let hwp = HwParams::any(pcm).context("初始化 ALSA processed HW 参数失败")?;
    hwp.set_rate_resample(false)
        .context("关闭 ALSA processed rate resample 失败")?;
    hwp.set_access(Access::RWInterleaved)
        .context("设置 ALSA processed RW_INTERLEAVED 失败")?;
    hwp.set_format(candidate.alsa_format())
        .with_context(|| format!("ALSA processed 不支持候选格式 {candidate:?}"))?;
    hwp.set_channels(u32::from(channels))
        .with_context(|| format!("ALSA processed 不支持 {channels} 声道"))?;
    let actual_rate = hwp
        .set_rate_near(requested_rate, ValueOr::Nearest)
        .with_context(|| format!("ALSA processed 无法协商 {requested_rate} Hz 附近的采样率"))?;
    ensure!(actual_rate > 0, "ALSA processed 实际采样率为 0");

    let (period_target, buffer_target) = buffer_targets(actual_rate);
    let period_frames = hwp
        .set_period_size_near(period_target, ValueOr::Nearest)
        .context("协商 ALSA processed period 失败")?;
    let buffer_frames = hwp
        .set_buffer_size_near(buffer_target)
        .context("协商 ALSA processed buffer 失败")?;
    ensure!(period_frames > 0, "ALSA processed period 为 0");
    ensure!(
        buffer_frames >= period_frames,
        "ALSA processed buffer 小于 period"
    );

    pcm.hw_params(&hwp)
        .context("提交 ALSA processed HW 参数失败")?;
    let current = pcm
        .hw_params_current()
        .context("读取 ALSA processed HW 参数失败")?;
    ensure!(
        current.get_access()? == Access::RWInterleaved,
        "ALSA processed 实际 access 不是 RW_INTERLEAVED"
    );
    ensure!(
        current.get_format()? == candidate.alsa_format(),
        "ALSA processed 实际样本格式与请求不一致"
    );
    ensure!(
        current.get_channels()? == u32::from(channels),
        "ALSA processed 实际声道数与源不一致"
    );
    ensure!(
        !current.get_rate_resample()?,
        "ALSA processed 实际配置仍启用了 ALSA rate resample"
    );
    let actual_rate = current.get_rate()?;
    let actual_period = current.get_period_size()?;
    let actual_buffer = current.get_buffer_size()?;

    let swp = pcm
        .sw_params_current()
        .context("读取 ALSA processed SW 参数失败")?;
    swp.set_avail_min(actual_period)
        .context("设置 ALSA processed avail_min 失败")?;
    swp.set_start_threshold(actual_buffer)
        .context("设置 ALSA processed start_threshold 失败")?;
    swp.set_stop_threshold(actual_buffer)
        .context("设置 ALSA processed stop_threshold 失败")?;
    pcm.sw_params(&swp)
        .context("提交 ALSA processed SW 参数失败")?;

    Ok(AlsaPcmConfig {
        format: candidate,
        sample_rate: actual_rate,
        channels,
        significant_bits: candidate.significant_bits(),
        period_frames: u64::try_from(actual_period).context("ALSA processed period 越界")?,
        buffer_frames: u64::try_from(actual_buffer).context("ALSA processed buffer 越界")?,
        can_pause: current.can_pause(),
    })
}

fn configure_candidate(
    pcm: &PCM,
    source: DirectPcmFormat,
    candidate: AlsaPcmFormat,
    significant_bits: u8,
) -> Result<AlsaPcmConfig> {
    if source.sample_format != DirectPcmSampleFormat::Float32 {
        ensure!(
            significant_bits >= source.valid_bits,
            "ALSA 硬件有效位只有 {significant_bits} bit，无法保留 {} bit 源",
            source.valid_bits
        );
    }
    let hwp = HwParams::any(pcm).context("初始化 ALSA HW 参数失败")?;
    hwp.set_rate_resample(false)
        .context("关闭 ALSA rate resample 失败")?;
    hwp.set_access(Access::RWInterleaved)
        .context("设置 ALSA RW_INTERLEAVED 失败")?;
    hwp.set_format(candidate.alsa_format())
        .with_context(|| format!("ALSA 不支持候选格式 {candidate:?}"))?;
    hwp.set_channels(u32::from(source.channels))
        .with_context(|| format!("ALSA 不支持 {} 声道", source.channels))?;

    let actual_rate = hwp
        .set_rate_near(source.sample_rate, ValueOr::Nearest)
        .with_context(|| format!("ALSA 不支持 {} Hz", source.sample_rate))?;
    ensure!(
        actual_rate == source.sample_rate,
        "ALSA rate 只能协商到 {actual_rate} Hz，源为 {} Hz",
        source.sample_rate
    );

    let (period_target, buffer_target) = buffer_targets(source.sample_rate);
    let period_frames = hwp
        .set_period_size_near(period_target, ValueOr::Nearest)
        .context("协商 ALSA period 失败")?;
    let buffer_frames = hwp
        .set_buffer_size_near(buffer_target)
        .context("协商 ALSA buffer 失败")?;
    ensure!(period_frames > 0, "ALSA period 为 0");
    ensure!(buffer_frames >= period_frames, "ALSA buffer 小于 period");

    pcm.hw_params(&hwp).context("提交 ALSA HW 参数失败")?;
    let current = pcm.hw_params_current().context("读取 ALSA HW 参数失败")?;
    ensure!(
        current.get_access()? == Access::RWInterleaved,
        "ALSA 实际 access 不是 RW_INTERLEAVED"
    );
    ensure!(
        current.get_format()? == candidate.alsa_format(),
        "ALSA 实际样本格式与请求不一致"
    );
    ensure!(
        current.get_rate()? == source.sample_rate,
        "ALSA 实际采样率与源不一致"
    );
    ensure!(
        current.get_channels()? == u32::from(source.channels),
        "ALSA 实际声道数与源不一致"
    );
    ensure!(
        !current.get_rate_resample()?,
        "ALSA 实际配置仍启用了 rate resample"
    );

    let actual_period = current.get_period_size()?;
    let actual_buffer = current.get_buffer_size()?;
    ensure!(actual_period > 0, "ALSA 实际 period 为 0");
    ensure!(
        actual_buffer >= actual_period,
        "ALSA 实际 buffer 小于 period"
    );

    let swp = pcm.sw_params_current().context("读取 ALSA SW 参数失败")?;
    swp.set_avail_min(actual_period)
        .context("设置 ALSA avail_min 失败")?;
    swp.set_start_threshold(actual_buffer)
        .context("设置 ALSA start_threshold 失败")?;
    swp.set_stop_threshold(actual_buffer)
        .context("设置 ALSA stop_threshold 失败")?;
    pcm.sw_params(&swp).context("提交 ALSA SW 参数失败")?;

    Ok(AlsaPcmConfig {
        format: candidate,
        sample_rate: source.sample_rate,
        channels: source.channels,
        significant_bits,
        period_frames: u64::try_from(actual_period).context("ALSA period 越界")?,
        buffer_frames: u64::try_from(actual_buffer).context("ALSA buffer 越界")?,
        can_pause: current.can_pause(),
    })
}

/// `alsa` crate 暂未暴露 `snd_pcm_hw_params_get_sbits`，只在这里补一小段局部 FFI。
/// 查询句柄在正式 PCM 打开前关闭，不参与 writer 生命周期。
fn query_significant_bits(
    endpoint: &AlsaHwEndpoint,
    source: DirectPcmFormat,
    candidate: AlsaPcmFormat,
) -> Result<u8> {
    let pcm_name = CString::new(endpoint.pcm_name()).context("ALSA HW PCM 名称包含 NUL")?;
    let mut raw_pcm = ptr::null_mut();
    alsa_call(
        unsafe {
            alsa_sys::snd_pcm_open(
                &mut raw_pcm,
                pcm_name.as_ptr(),
                alsa_sys::SND_PCM_STREAM_PLAYBACK,
                1,
            )
        },
        "打开 ALSA HW PCM 进行 sbits 探测",
    )?;
    let pcm = RawPcm(raw_pcm);

    let mut raw_params = ptr::null_mut();
    alsa_call(
        unsafe { alsa_sys::snd_pcm_hw_params_malloc(&mut raw_params) },
        "分配 ALSA HW params",
    )?;
    let params = RawHwParams(raw_params);
    alsa_call(
        unsafe { alsa_sys::snd_pcm_hw_params_any(pcm.0, params.0) },
        "初始化 ALSA HW params",
    )?;
    alsa_call(
        unsafe { alsa_sys::snd_pcm_hw_params_set_rate_resample(pcm.0, params.0, 0) },
        "关闭 ALSA rate resample",
    )?;
    alsa_call(
        unsafe {
            alsa_sys::snd_pcm_hw_params_set_access(
                pcm.0,
                params.0,
                alsa_sys::SND_PCM_ACCESS_RW_INTERLEAVED,
            )
        },
        "约束 ALSA RW_INTERLEAVED",
    )?;
    alsa_call(
        unsafe {
            alsa_sys::snd_pcm_hw_params_set_format(pcm.0, params.0, candidate.alsa_sys_format())
        },
        "约束 ALSA PCM format",
    )?;
    alsa_call(
        unsafe {
            alsa_sys::snd_pcm_hw_params_set_channels(pcm.0, params.0, u32::from(source.channels))
        },
        "约束 ALSA channels",
    )?;
    alsa_call(
        unsafe { alsa_sys::snd_pcm_hw_params_set_rate(pcm.0, params.0, source.sample_rate, 0) },
        "约束 ALSA sample rate",
    )?;

    let significant_bits = unsafe { alsa_sys::snd_pcm_hw_params_get_sbits(params.0) };
    ensure!(significant_bits > 0, "ALSA 未返回可信的硬件有效位深");
    let significant_bits = u8::try_from(significant_bits).context("ALSA sbits 越界")?;
    ensure!(
        significant_bits >= source.valid_bits,
        "ALSA 硬件有效位只有 {significant_bits} bit，无法保留 {} bit 源",
        source.valid_bits
    );
    Ok(significant_bits)
}

struct RawPcm(*mut alsa_sys::snd_pcm_t);

impl Drop for RawPcm {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { alsa_sys::snd_pcm_close(self.0) };
        }
    }
}

struct RawHwParams(*mut alsa_sys::snd_pcm_hw_params_t);

impl Drop for RawHwParams {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { alsa_sys::snd_pcm_hw_params_free(self.0) };
        }
    }
}

fn alsa_call(code: i32, action: &str) -> Result<()> {
    ensure!(code >= 0, "{action}失败: ALSA error {code}");
    Ok(())
}

pub(crate) fn buffer_targets(sample_rate: u32) -> (alsa::pcm::Frames, alsa::pcm::Frames) {
    let period = u64::from(sample_rate)
        .saturating_mul(u64::from(TARGET_PERIOD_MS))
        .div_ceil(1000)
        .max(1);
    let buffer = u64::from(sample_rate)
        .saturating_mul(u64::from(TARGET_BUFFER_MS))
        .div_ceil(1000)
        .max(period);
    (
        period.min(i64::MAX as u64) as alsa::pcm::Frames,
        buffer.min(i64::MAX as u64) as alsa::pcm::Frames,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_targets_follow_ten_and_two_hundred_milliseconds() {
        assert_eq!(buffer_targets(44_100), (441, 8_820));
        assert_eq!(buffer_targets(48_000), (480, 9_600));
        assert_eq!(buffer_targets(768_000), (7_680, 153_600));
    }
}
