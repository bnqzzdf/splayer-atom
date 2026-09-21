use alsa::pcm::Format;
use anyhow::{bail, ensure, Context, Result};

use crate::direct_pcm::{DirectPcmFormat, DirectPcmSampleFormat};

/// ALSA HW PCM transport 需要显式支持的格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlsaPcmFormat {
    F32Le,
    S16Le,
    S24_3Le,
    S24Le,
    S32Le,
}

impl AlsaPcmFormat {
    pub const fn storage_bytes(self) -> usize {
        match self {
            Self::F32Le => 4,
            Self::S16Le => 2,
            Self::S24_3Le => 3,
            Self::S24Le | Self::S32Le => 4,
        }
    }

    pub const fn significant_bits(self) -> u8 {
        match self {
            Self::F32Le => 32,
            Self::S16Le => 16,
            Self::S24_3Le | Self::S24Le => 24,
            Self::S32Le => 32,
        }
    }

    pub const fn alsa_format(self) -> Format {
        match self {
            Self::F32Le => Format::FloatLE,
            Self::S16Le => Format::S16LE,
            Self::S24_3Le => Format::S243LE,
            Self::S24Le => Format::S24LE,
            Self::S32Le => Format::S32LE,
        }
    }

    pub const fn alsa_sys_format(self) -> alsa_sys::snd_pcm_format_t {
        match self {
            Self::F32Le => alsa_sys::SND_PCM_FORMAT_FLOAT_LE,
            Self::S16Le => alsa_sys::SND_PCM_FORMAT_S16_LE,
            Self::S24_3Le => alsa_sys::SND_PCM_FORMAT_S24_3LE,
            Self::S24Le => alsa_sys::SND_PCM_FORMAT_S24_LE,
            Self::S32Le => alsa_sys::SND_PCM_FORMAT_S32_LE,
        }
    }
}

/// 为 Direct PCM 生成有限候选。
/// 整数 lossless 绝不降低有效位；Float32 优先原表示，硬件不支持时才允许一次整数量化。
pub fn direct_pcm_candidates(source: DirectPcmFormat) -> Result<Vec<AlsaPcmFormat>> {
    validate_source_format(source)?;
    let candidates = match (source.sample_format, source.valid_bits) {
        (DirectPcmSampleFormat::Signed16, 1..=16) => vec![
            AlsaPcmFormat::S16Le,
            AlsaPcmFormat::S24_3Le,
            AlsaPcmFormat::S24Le,
            AlsaPcmFormat::S32Le,
        ],
        (DirectPcmSampleFormat::Signed32, 1..=24) => vec![
            AlsaPcmFormat::S32Le,
            AlsaPcmFormat::S24_3Le,
            AlsaPcmFormat::S24Le,
        ],
        (DirectPcmSampleFormat::Signed32, 25..=32) => vec![AlsaPcmFormat::S32Le],
        (DirectPcmSampleFormat::Float32, 32) => vec![
            AlsaPcmFormat::F32Le,
            AlsaPcmFormat::S32Le,
            AlsaPcmFormat::S24_3Le,
            AlsaPcmFormat::S24Le,
            AlsaPcmFormat::S16Le,
        ],
        _ => bail!(
            "ALSA direct PCM 源表示不受支持: {:?}/{} bit",
            source.sample_format,
            source.valid_bits
        ),
    };
    Ok(candidates)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirectPackStats {
    pub bytes: usize,
    pub quantized: bool,
    pub clipped: bool,
}

/// 将 Direct PCM 打包到指定 ALSA 格式。
///
/// 整数输入只做精确位位置适配；Float32→整数使用 ties-to-even 单次量化，
/// 不加增益、dither、limiter 或 normalization。
pub fn pack_direct_pcm(
    source: DirectPcmFormat,
    input: &[u8],
    target: AlsaPcmFormat,
    output: &mut [u8],
) -> Result<DirectPackStats> {
    validate_source_format(source)?;
    let float_source = source.sample_format == DirectPcmSampleFormat::Float32;
    if !float_source {
        ensure!(
            target.significant_bits() >= source.valid_bits,
            "ALSA 目标格式 {} bit 无法保留 {} bit 有效位",
            target.significant_bits(),
            source.valid_bits
        );
    }

    let source_bytes = usize::from(source.storage_bits / 8);
    ensure!(
        input.len().is_multiple_of(source_bytes),
        "Direct PCM payload 未按源样本宽度对齐"
    );
    let samples = input.len() / source_bytes;
    let required = samples
        .checked_mul(target.storage_bytes())
        .context("ALSA PCM 输出长度溢出")?;
    ensure!(output.len() >= required, "ALSA PCM 输出缓冲区不足");

    let mut clipped = false;
    for sample_index in 0..samples {
        let source_offset = sample_index * source_bytes;
        if source.sample_format == DirectPcmSampleFormat::Float32 {
            let sample = f32::from_le_bytes(
                input[source_offset..source_offset + 4]
                    .try_into()
                    .expect("已验证 F32 样本长度"),
            );
            let target_offset = sample_index * target.storage_bytes();
            match target {
                AlsaPcmFormat::F32Le => {
                    output[target_offset..target_offset + 4].copy_from_slice(&sample.to_le_bytes());
                }
                AlsaPcmFormat::S16Le
                | AlsaPcmFormat::S24_3Le
                | AlsaPcmFormat::S24Le
                | AlsaPcmFormat::S32Le => {
                    let finite = if sample.is_finite() { sample } else { 0.0 };
                    if !sample.is_finite() || !(-1.0..=1.0).contains(&finite) {
                        clipped = true;
                    }
                    let clamped = finite.clamp(-1.0, 1.0);
                    let bits = target.significant_bits();
                    let value = quantize_signed(clamped, bits);
                    match target {
                        AlsaPcmFormat::S16Le => {
                            output[target_offset..target_offset + 2]
                                .copy_from_slice(&(value as i16).to_le_bytes());
                        }
                        AlsaPcmFormat::S24_3Le => {
                            let bytes = (value as i32).to_le_bytes();
                            output[target_offset..target_offset + 3].copy_from_slice(&bytes[..3]);
                        }
                        AlsaPcmFormat::S24Le => {
                            let bytes = (value as i32).to_le_bytes();
                            output[target_offset..target_offset + 3].copy_from_slice(&bytes[..3]);
                            output[target_offset + 3] = 0;
                        }
                        AlsaPcmFormat::S32Le => {
                            output[target_offset..target_offset + 4]
                                .copy_from_slice(&(value as i32).to_le_bytes());
                        }
                        AlsaPcmFormat::F32Le => unreachable!(),
                    }
                }
            }
            continue;
        }

        let raw = match source.sample_format {
            DirectPcmSampleFormat::Signed16 => i64::from(i16::from_le_bytes(
                input[source_offset..source_offset + 2]
                    .try_into()
                    .expect("已验证 S16 样本长度"),
            )),
            DirectPcmSampleFormat::Signed32 => i64::from(i32::from_le_bytes(
                input[source_offset..source_offset + 4]
                    .try_into()
                    .expect("已验证 S32 样本长度"),
            )),
            DirectPcmSampleFormat::Float32 => unreachable!(),
        };
        let source_shift = source.storage_bits - source.valid_bits;
        let normalized = raw >> source_shift;
        let target_shift = target.significant_bits() - source.valid_bits;
        let value = normalized << target_shift;
        let target_offset = sample_index * target.storage_bytes();

        match target {
            AlsaPcmFormat::F32Le => {
                bail!("Direct integer PCM 不允许转换为 float transport")
            }
            AlsaPcmFormat::S16Le => {
                let value = i16::try_from(value).context("ALSA S16 样本越界")?;
                output[target_offset..target_offset + 2].copy_from_slice(&value.to_le_bytes());
            }
            AlsaPcmFormat::S24_3Le => {
                let bytes = i32::try_from(value)
                    .context("ALSA S24_3 样本越界")?
                    .to_le_bytes();
                output[target_offset..target_offset + 3].copy_from_slice(&bytes[..3]);
            }
            AlsaPcmFormat::S24Le => {
                let bytes = i32::try_from(value)
                    .context("ALSA S24 样本越界")?
                    .to_le_bytes();
                output[target_offset..target_offset + 3].copy_from_slice(&bytes[..3]);
                output[target_offset + 3] = 0;
            }
            AlsaPcmFormat::S32Le => {
                let value = i32::try_from(value).context("ALSA S32 样本越界")?;
                output[target_offset..target_offset + 4].copy_from_slice(&value.to_le_bytes());
            }
        }
    }

    Ok(DirectPackStats {
        bytes: required,
        quantized: float_source && target != AlsaPcmFormat::F32Le,
        clipped,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessedPackStats {
    pub bytes: usize,
    pub clipped: bool,
}

/// 把 DSP 后的 f32 PCM 转成最终 ALSA transport 表示。
///
/// 软件音量/fade 在块边界读取并应用；整数目标使用 ties-to-even 单次量化，不加抖动。
pub fn pack_processed_pcm(
    input: &[f32],
    gain: f32,
    target: AlsaPcmFormat,
    output: &mut [u8],
) -> Result<ProcessedPackStats> {
    ensure!(gain.is_finite() && gain >= 0.0, "processed PCM gain 无效");
    let required = input
        .len()
        .checked_mul(target.storage_bytes())
        .context("processed PCM 输出长度溢出")?;
    ensure!(output.len() >= required, "processed PCM 输出缓冲区不足");

    let mut clipped = false;
    for (index, sample) in input.iter().copied().enumerate() {
        let scaled = if sample.is_finite() {
            sample * gain
        } else {
            0.0
        };
        if !sample.is_finite() || !(-1.0..=1.0).contains(&scaled) {
            clipped = true;
        }
        let clamped = scaled.clamp(-1.0, 1.0);
        let offset = index * target.storage_bytes();
        match target {
            AlsaPcmFormat::F32Le => {
                output[offset..offset + 4].copy_from_slice(&clamped.to_le_bytes());
            }
            AlsaPcmFormat::S16Le => {
                let value = quantize_signed(clamped, 16) as i16;
                output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
            }
            AlsaPcmFormat::S24_3Le => {
                let value = quantize_signed(clamped, 24) as i32;
                let bytes = value.to_le_bytes();
                output[offset..offset + 3].copy_from_slice(&bytes[..3]);
            }
            AlsaPcmFormat::S24Le => {
                let value = quantize_signed(clamped, 24) as i32;
                let bytes = value.to_le_bytes();
                output[offset..offset + 3].copy_from_slice(&bytes[..3]);
                output[offset + 3] = 0;
            }
            AlsaPcmFormat::S32Le => {
                let value = quantize_signed(clamped, 32) as i32;
                output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            }
        }
    }
    Ok(ProcessedPackStats {
        bytes: required,
        clipped,
    })
}

fn quantize_signed(sample: f32, bits: u8) -> i64 {
    let scale = (1_u64 << (bits - 1)) as f64;
    let min = -(scale as i64);
    let max = scale as i64 - 1;
    ((f64::from(sample) * scale).round_ties_even() as i64).clamp(min, max)
}

fn validate_source_format(source: DirectPcmFormat) -> Result<()> {
    let expected_storage_bits = match source.sample_format {
        DirectPcmSampleFormat::Signed16 => 16,
        DirectPcmSampleFormat::Signed32 => 32,
        DirectPcmSampleFormat::Float32 => 32,
    };
    ensure!(
        source.storage_bits == expected_storage_bits,
        "Direct PCM sample/storage 位宽不一致"
    );
    ensure!(
        source.valid_bits > 0 && source.valid_bits <= source.storage_bits,
        "Direct PCM 有效位深无效"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct_pcm::DirectPcmMemoryPath;

    fn format(
        valid_bits: u8,
        storage_bits: u8,
        sample_format: DirectPcmSampleFormat,
    ) -> DirectPcmFormat {
        DirectPcmFormat {
            sample_rate: 96_000,
            channels: 2,
            valid_bits,
            storage_bits,
            sample_format,
            memory_path: DirectPcmMemoryPath::ZeroCopyPacked,
        }
    }

    #[test]
    fn candidates_never_reduce_valid_bits() {
        assert_eq!(
            direct_pcm_candidates(format(16, 16, DirectPcmSampleFormat::Signed16)).unwrap(),
            vec![
                AlsaPcmFormat::S16Le,
                AlsaPcmFormat::S24_3Le,
                AlsaPcmFormat::S24Le,
                AlsaPcmFormat::S32Le,
            ]
        );
        assert_eq!(
            direct_pcm_candidates(format(24, 32, DirectPcmSampleFormat::Signed32)).unwrap(),
            vec![
                AlsaPcmFormat::S32Le,
                AlsaPcmFormat::S24_3Le,
                AlsaPcmFormat::S24Le,
            ]
        );
        assert_eq!(
            direct_pcm_candidates(format(32, 32, DirectPcmSampleFormat::Signed32)).unwrap(),
            vec![AlsaPcmFormat::S32Le]
        );
        assert_eq!(
            direct_pcm_candidates(format(32, 32, DirectPcmSampleFormat::Float32)).unwrap(),
            vec![
                AlsaPcmFormat::F32Le,
                AlsaPcmFormat::S32Le,
                AlsaPcmFormat::S24_3Le,
                AlsaPcmFormat::S24Le,
                AlsaPcmFormat::S16Le,
            ]
        );
    }

    #[test]
    fn packs_left_aligned_s24_into_three_byte_transport() {
        let samples = [-0x80_0000_i32, -1, 0, 1, 0x7f_ffff];
        let input: Vec<u8> = samples
            .iter()
            .flat_map(|sample| (sample << 8).to_le_bytes())
            .collect();
        let mut output = vec![0_u8; samples.len() * 3];
        let stats = pack_direct_pcm(
            format(24, 32, DirectPcmSampleFormat::Signed32),
            &input,
            AlsaPcmFormat::S24_3Le,
            &mut output,
        )
        .unwrap();
        assert_eq!(stats.bytes, output.len());
        assert!(!stats.quantized);
        assert!(!stats.clipped);

        let expected: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes()[..3].to_vec())
            .collect();
        assert_eq!(output, expected);
    }

    #[test]
    fn expands_s16_without_changing_effective_bits() {
        let samples = [i16::MIN, -1, 0, 1, i16::MAX];
        let input: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        let mut output = vec![0_u8; samples.len() * 4];
        pack_direct_pcm(
            format(16, 16, DirectPcmSampleFormat::Signed16),
            &input,
            AlsaPcmFormat::S32Le,
            &mut output,
        )
        .unwrap();
        let decoded: Vec<i32> = output
            .chunks_exact(4)
            .map(|bytes| i32::from_le_bytes(bytes.try_into().unwrap()))
            .collect();
        let expected: Vec<i32> = samples
            .iter()
            .map(|sample| i32::from(*sample) << 16)
            .collect();
        assert_eq!(decoded, expected);
    }

    #[test]
    fn s24_in_32_slot_uses_low_three_bytes_and_zero_padding() {
        let samples = [-0x80_0000_i32, -1, 0x7f_ffff];
        let input: Vec<u8> = samples
            .iter()
            .flat_map(|sample| (sample << 8).to_le_bytes())
            .collect();
        let mut output = vec![0_u8; samples.len() * 4];
        pack_direct_pcm(
            format(24, 32, DirectPcmSampleFormat::Signed32),
            &input,
            AlsaPcmFormat::S24Le,
            &mut output,
        )
        .unwrap();
        for (chunk, sample) in output.chunks_exact(4).zip(samples) {
            assert_eq!(&chunk[..3], &sample.to_le_bytes()[..3]);
            assert_eq!(chunk[3], 0);
        }
    }

    #[test]
    fn rejects_target_that_would_drop_valid_bits() {
        let mut output = [0_u8; 2];
        let error = pack_direct_pcm(
            format(24, 32, DirectPcmSampleFormat::Signed32),
            &[0, 0, 0, 0],
            AlsaPcmFormat::S16Le,
            &mut output,
        )
        .unwrap_err();
        assert!(error.to_string().contains("无法保留"));
    }

    #[test]
    fn direct_float_prefers_exact_f32_and_quantizes_only_when_needed() {
        let input = [0.5_f32, -0.5, 1.25, f32::NAN];
        let bytes: Vec<u8> = input
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();

        let mut exact = vec![0_u8; bytes.len()];
        let exact_stats = pack_direct_pcm(
            format(32, 32, DirectPcmSampleFormat::Float32),
            &bytes,
            AlsaPcmFormat::F32Le,
            &mut exact,
        )
        .unwrap();
        assert_eq!(exact, bytes);
        assert!(!exact_stats.quantized);
        assert!(!exact_stats.clipped);

        let mut integer = vec![0_u8; input.len() * 2];
        let integer_stats = pack_direct_pcm(
            format(32, 32, DirectPcmSampleFormat::Float32),
            &bytes,
            AlsaPcmFormat::S16Le,
            &mut integer,
        )
        .unwrap();
        assert!(integer_stats.quantized);
        assert!(integer_stats.clipped);
        let decoded: Vec<i16> = integer
            .chunks_exact(2)
            .map(|bytes| i16::from_le_bytes(bytes.try_into().unwrap()))
            .collect();
        assert_eq!(decoded, vec![16384, -16384, i16::MAX, 0]);
    }

    #[test]
    fn processed_float_pack_applies_gain_and_reports_clipping() {
        let input = [0.5_f32, -0.5, 2.0, f32::NAN];
        let mut output = vec![0_u8; input.len() * 4];
        let stats = pack_processed_pcm(&input, 0.5, AlsaPcmFormat::F32Le, &mut output).unwrap();
        assert_eq!(stats.bytes, output.len());
        assert!(stats.clipped);
        let decoded: Vec<f32> = output
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect();
        assert_eq!(decoded, vec![0.25, -0.25, 1.0, 0.0]);
    }

    #[test]
    fn processed_integer_pack_uses_ties_to_even_and_saturates() {
        let input = [0.5_f32 / 32768.0, 1.5_f32 / 32768.0, -1.0, 1.0];
        let mut output = vec![0_u8; input.len() * 2];
        pack_processed_pcm(&input, 1.0, AlsaPcmFormat::S16Le, &mut output).unwrap();
        let decoded: Vec<i16> = output
            .chunks_exact(2)
            .map(|bytes| i16::from_le_bytes(bytes.try_into().unwrap()))
            .collect();
        assert_eq!(decoded, vec![0, 2, i16::MIN, i16::MAX]);
    }
}
