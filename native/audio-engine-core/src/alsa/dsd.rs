use alsa::pcm::{Access, Format, HwParams};
use alsa::{Direction, ValueOr, PCM};
use anyhow::{anyhow, ensure, Context, Result};

use super::device::AlsaHwEndpoint;
use super::output::buffer_targets;
use crate::direct_dsd::DirectDsdFormat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlsaDsdFormat {
    U8,
    U16Le,
    U16Be,
    U32Le,
    U32Be,
}

impl AlsaDsdFormat {
    pub const fn bits_per_channel_frame(self) -> u8 {
        match self {
            Self::U8 => 8,
            Self::U16Le | Self::U16Be => 16,
            Self::U32Le | Self::U32Be => 32,
        }
    }

    pub const fn storage_bytes(self) -> usize {
        (self.bits_per_channel_frame() / 8) as usize
    }

    pub const fn alsa_format(self) -> Format {
        match self {
            Self::U8 => Format::DSDU8,
            Self::U16Le => Format::DSDU16LE,
            Self::U16Be => Format::DSDU16BE,
            Self::U32Le => Format::DSDU32LE,
            Self::U32Be => Format::DSDU32BE,
        }
    }

    pub const fn needs_word_byte_swap(self) -> bool {
        matches!(self, Self::U16Le | Self::U32Le)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AlsaDsdConfig {
    pub format: AlsaDsdFormat,
    pub frame_rate: u32,
    pub channels: u16,
    pub bits_per_channel_frame: u8,
    pub period_frames: u64,
    pub buffer_frames: u64,
    pub can_pause: bool,
}

pub struct AlsaDsdHandle {
    pcm: PCM,
    config: AlsaDsdConfig,
}

impl AlsaDsdHandle {
    pub fn config(&self) -> AlsaDsdConfig {
        self.config
    }

    pub(crate) fn into_parts(self) -> (PCM, AlsaDsdConfig) {
        (self.pcm, self.config)
    }
}

pub fn dsd_candidates(source: DirectDsdFormat) -> Result<Vec<AlsaDsdFormat>> {
    ensure!(source.bit_rate > 0, "Native DSD bit rate 无效");
    ensure!(source.channels > 0, "Native DSD 声道数无效");
    let mut result = Vec::new();
    for format in [
        AlsaDsdFormat::U8,
        AlsaDsdFormat::U16Be,
        AlsaDsdFormat::U16Le,
        AlsaDsdFormat::U32Be,
        AlsaDsdFormat::U32Le,
    ] {
        if source
            .bit_rate
            .is_multiple_of(u32::from(format.bits_per_channel_frame()))
        {
            result.push(format);
        }
    }
    ensure!(
        !result.is_empty(),
        "Native DSD bit rate 无法映射到 ALSA DSD frame"
    );
    Ok(result)
}

pub fn open_dsd_hw(endpoint: &AlsaHwEndpoint, source: DirectDsdFormat) -> Result<AlsaDsdHandle> {
    let mut last_error = None;
    for candidate in dsd_candidates(source)? {
        let pcm_name = endpoint.pcm_name();
        let pcm = match PCM::new(&pcm_name, Direction::Playback, true) {
            Ok(value) => value,
            Err(error) => {
                last_error = Some(
                    anyhow!(error).context(format!("打开 ALSA Native DSD HW PCM 失败: {pcm_name}")),
                );
                continue;
            }
        };
        match configure_candidate(&pcm, source, candidate) {
            Ok(config) => return Ok(AlsaDsdHandle { pcm, config }),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("ALSA HW 没有可用 Native DSD 格式")))
}

fn configure_candidate(
    pcm: &PCM,
    source: DirectDsdFormat,
    candidate: AlsaDsdFormat,
) -> Result<AlsaDsdConfig> {
    let bits = u32::from(candidate.bits_per_channel_frame());
    ensure!(
        source.bit_rate.is_multiple_of(bits),
        "Native DSD bit rate 无法整除 ALSA DSD frame 宽度"
    );
    let frame_rate = source.bit_rate / bits;
    let hwp = HwParams::any(pcm).context("初始化 ALSA Native DSD HW 参数失败")?;
    hwp.set_rate_resample(false)
        .context("关闭 ALSA Native DSD rate resample 失败")?;
    hwp.set_access(Access::RWInterleaved)
        .context("设置 ALSA Native DSD RW_INTERLEAVED 失败")?;
    hwp.set_format(candidate.alsa_format())
        .with_context(|| format!("ALSA 不支持 Native DSD 格式 {candidate:?}"))?;
    hwp.set_channels(u32::from(source.channels))
        .with_context(|| format!("ALSA Native DSD 不支持 {} 声道", source.channels))?;
    let actual_rate = hwp
        .set_rate_near(frame_rate, ValueOr::Nearest)
        .with_context(|| format!("ALSA Native DSD 不支持 {frame_rate} frame/s"))?;
    ensure!(
        actual_rate == frame_rate,
        "ALSA Native DSD rate 只能协商到 {actual_rate}，要求 {frame_rate}"
    );

    let (period_target, buffer_target) = buffer_targets(frame_rate);
    let period_frames = hwp
        .set_period_size_near(period_target, ValueOr::Nearest)
        .context("协商 ALSA Native DSD period 失败")?;
    let buffer_frames = hwp
        .set_buffer_size_near(buffer_target)
        .context("协商 ALSA Native DSD buffer 失败")?;
    ensure!(period_frames > 0, "ALSA Native DSD period 为 0");
    ensure!(
        buffer_frames >= period_frames,
        "ALSA Native DSD buffer 小于 period"
    );

    pcm.hw_params(&hwp)
        .context("提交 ALSA Native DSD HW 参数失败")?;
    let current = pcm
        .hw_params_current()
        .context("读取 ALSA Native DSD HW 参数失败")?;
    ensure!(
        current.get_access()? == Access::RWInterleaved,
        "ALSA Native DSD 实际 access 不是 RW_INTERLEAVED"
    );
    ensure!(
        current.get_format()? == candidate.alsa_format(),
        "ALSA Native DSD 实际格式与请求不一致"
    );
    ensure!(
        current.get_rate()? == frame_rate,
        "ALSA Native DSD 实际 frame rate 与请求不一致"
    );
    ensure!(
        current.get_channels()? == u32::from(source.channels),
        "ALSA Native DSD 实际声道数与源不一致"
    );
    ensure!(
        !current.get_rate_resample()?,
        "ALSA Native DSD 实际配置仍启用了 rate resample"
    );
    let actual_period = current.get_period_size()?;
    let actual_buffer = current.get_buffer_size()?;

    let swp = pcm
        .sw_params_current()
        .context("读取 ALSA Native DSD SW 参数失败")?;
    swp.set_avail_min(actual_period)
        .context("设置 ALSA Native DSD avail_min 失败")?;
    swp.set_start_threshold(actual_buffer)
        .context("设置 ALSA Native DSD start_threshold 失败")?;
    swp.set_stop_threshold(actual_buffer)
        .context("设置 ALSA Native DSD stop_threshold 失败")?;
    pcm.sw_params(&swp)
        .context("提交 ALSA Native DSD SW 参数失败")?;

    Ok(AlsaDsdConfig {
        format: candidate,
        frame_rate,
        channels: source.channels,
        bits_per_channel_frame: candidate.bits_per_channel_frame(),
        period_frames: u64::try_from(actual_period).context("ALSA Native DSD period 越界")?,
        buffer_frames: u64::try_from(actual_buffer).context("ALSA Native DSD buffer 越界")?,
        can_pause: current.can_pause(),
    })
}

/// 输入是 MSB-first logical DSD，且已按目标 word 宽度做 channel grouping。
/// BE/U8 可直接发送；LE 只反转每声道 word 内的字节顺序，不反转 byte 内 bit。
pub fn pack_grouped_msb_dsd(
    input: &[u8],
    channels: u16,
    target: AlsaDsdFormat,
    output: &mut [u8],
) -> Result<usize> {
    let channels = usize::from(channels);
    ensure!(channels > 0, "Native DSD 声道数无效");
    let group_bytes = target.storage_bytes();
    let frame_bytes = channels
        .checked_mul(group_bytes)
        .context("ALSA Native DSD frame bytes 溢出")?;
    ensure!(
        input.len().is_multiple_of(frame_bytes),
        "Native DSD payload 未按 ALSA word/channel 对齐"
    );
    ensure!(
        output.len() >= input.len(),
        "ALSA Native DSD 输出缓冲区不足"
    );

    if !target.needs_word_byte_swap() {
        output[..input.len()].copy_from_slice(input);
        return Ok(input.len());
    }
    for (src_frame, dst_frame) in input
        .chunks_exact(frame_bytes)
        .zip(output[..input.len()].chunks_exact_mut(frame_bytes))
    {
        for channel in 0..channels {
            let offset = channel * group_bytes;
            for byte in 0..group_bytes {
                dst_frame[offset + byte] = src_frame[offset + group_bytes - 1 - byte];
            }
        }
    }
    Ok(input.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct_dsd::{DirectDsdBitOrder, DirectDsdContainer};

    fn source() -> DirectDsdFormat {
        DirectDsdFormat {
            bit_rate: 2_822_400,
            channels: 2,
            bit_order: DirectDsdBitOrder::LsbFirst,
            container: DirectDsdContainer::Dsf,
        }
    }

    #[test]
    fn candidates_use_exact_dsd_frame_rates_and_prefer_narrow_words() {
        assert_eq!(
            dsd_candidates(source()).unwrap(),
            vec![
                AlsaDsdFormat::U8,
                AlsaDsdFormat::U16Be,
                AlsaDsdFormat::U16Le,
                AlsaDsdFormat::U32Be,
                AlsaDsdFormat::U32Le,
            ]
        );
        assert_eq!(source().bit_rate / 8, 352_800);
        assert_eq!(source().bit_rate / 32, 88_200);
    }

    #[test]
    fn u32_be_keeps_grouped_logical_bytes_exactly() {
        let input = [0x01_u8, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let mut output = [0_u8; 8];
        let len = pack_grouped_msb_dsd(&input, 2, AlsaDsdFormat::U32Be, &mut output).unwrap();
        assert_eq!(len, input.len());
        assert_eq!(output, input);
    }

    #[test]
    fn little_endian_only_reverses_bytes_inside_each_channel_word() {
        let input = [0x01_u8, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let mut output = [0_u8; 8];
        pack_grouped_msb_dsd(&input, 2, AlsaDsdFormat::U32Le, &mut output).unwrap();
        assert_eq!(output, [0x67, 0x45, 0x23, 0x01, 0xef, 0xcd, 0xab, 0x89]);

        let mut restored = [0_u8; 8];
        pack_grouped_msb_dsd(&output, 2, AlsaDsdFormat::U32Le, &mut restored).unwrap();
        assert_eq!(restored, input);
    }

    #[test]
    fn u8_preserves_per_frame_channel_interleave() {
        let input = [0x11_u8, 0x91, 0x22, 0x92, 0x33, 0x93, 0x44, 0x94];
        let mut output = [0_u8; 8];
        pack_grouped_msb_dsd(&input, 2, AlsaDsdFormat::U8, &mut output).unwrap();
        assert_eq!(output, input);
    }
}
