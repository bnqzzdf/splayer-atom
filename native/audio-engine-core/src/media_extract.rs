//! Atom 额外输出使用的离线媒体提取。
//!
//! 这里只消费现有 strict reader 并生成完整文件，不拥有播放、设备或队列状态。

use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use anyhow::{bail, ensure, Context, Result};

use crate::cue::CueSheet;
use crate::direct_pcm::{DirectPcmDecoder, DirectPcmFormat, DirectPcmFrame};
use crate::dsd::{reverse_byte, DsfReader};
use crate::sacd::SacdTrackReader;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CueWavResult {
    pub sample_rate: u32,
    pub channels: u16,
    pub valid_bits: u8,
    pub storage_bits: u8,
    pub samples_per_channel: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DsdExtractResult {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_channel: u64,
    pub duration_ms: u64,
}

fn part_path(output: &Path) -> PathBuf {
    let mut value: OsString = output.as_os_str().to_owned();
    value.push(".part");
    PathBuf::from(value)
}

fn prepare_output(output: &Path) -> Result<PathBuf> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建输出目录失败: {}", parent.display()))?;
    }
    let part = part_path(output);
    let _ = fs::remove_file(&part);
    Ok(part)
}

fn publish_output(part: &Path, output: &Path) -> Result<()> {
    let _ = fs::remove_file(output);
    fs::rename(part, output).with_context(|| {
        format!(
            "发布媒体提取文件失败: {} -> {}",
            part.display(),
            output.display()
        )
    })
}

fn cue_frame_to_sample(frame75: u64, sample_rate: u32) -> Result<u64> {
    let numerator = frame75
        .checked_mul(u64::from(sample_rate))
        .context("CUE sample boundary 溢出")?;
    Ok(numerator.saturating_add(37) / 75)
}

fn wav_storage_bits(valid_bits: u8) -> Result<u8> {
    match valid_bits {
        1..=16 => Ok(16),
        17..=24 => Ok(24),
        25..=32 => Ok(32),
        _ => bail!("WAV 有效位深不支持: {valid_bits}"),
    }
}

struct WavWriter {
    file: File,
    format: DirectPcmFormat,
    output_storage_bits: u8,
    data_size_pos: u64,
    data_bytes: u64,
}

impl WavWriter {
    fn create(path: &Path, format: DirectPcmFormat) -> Result<Self> {
        ensure!(format.channels == 2, "UPnP CUE 仅支持双声道");
        ensure!(format.sample_rate > 0, "UPnP CUE sample rate 无效");
        let output_storage_bits = wav_storage_bits(format.valid_bits)?;
        ensure!(
            matches!(format.storage_bits, 16 | 32),
            "UPnP CUE 输入 storage bits 不支持: {}",
            format.storage_bits
        );
        ensure!(
            output_storage_bits <= format.storage_bits,
            "UPnP CUE 输出容器位宽大于 decoder storage"
        );
        let bytes_per_sample = u32::from(output_storage_bits / 8);
        let block_align = u16::try_from(u32::from(format.channels) * bytes_per_sample)
            .context("WAV block align 溢出")?;
        let byte_rate = format
            .sample_rate
            .checked_mul(u32::from(block_align))
            .context("WAV byte rate 溢出")?;
        let extensible = format.valid_bits != output_storage_bits;

        let mut file =
            File::create(path).with_context(|| format!("创建 WAV 失败: {}", path.display()))?;
        file.write_all(b"RIFF")?;
        file.write_all(&0_u32.to_le_bytes())?;
        file.write_all(b"WAVEfmt ")?;
        if extensible {
            file.write_all(&40_u32.to_le_bytes())?;
            file.write_all(&0xfffe_u16.to_le_bytes())?;
        } else {
            file.write_all(&16_u32.to_le_bytes())?;
            file.write_all(&1_u16.to_le_bytes())?;
        }
        file.write_all(&format.channels.to_le_bytes())?;
        file.write_all(&format.sample_rate.to_le_bytes())?;
        file.write_all(&byte_rate.to_le_bytes())?;
        file.write_all(&block_align.to_le_bytes())?;
        file.write_all(&u16::from(output_storage_bits).to_le_bytes())?;
        if extensible {
            file.write_all(&22_u16.to_le_bytes())?;
            file.write_all(&u16::from(format.valid_bits).to_le_bytes())?;
            file.write_all(&3_u32.to_le_bytes())?;
            file.write_all(&[
                0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38,
                0x9b, 0x71,
            ])?;
        }
        file.write_all(b"data")?;
        let data_size_pos = file.stream_position()?;
        file.write_all(&0_u32.to_le_bytes())?;
        Ok(Self {
            file,
            format,
            output_storage_bits,
            data_size_pos,
            data_bytes: 0,
        })
    }

    fn write_frames(&mut self, payload: &[u8], offset_frames: usize, frames: usize) -> Result<()> {
        if frames == 0 {
            return Ok(());
        }
        let channels = usize::from(self.format.channels);
        let input_bytes_per_sample = usize::from(self.format.storage_bits / 8);
        let input_frame_bytes = channels
            .checked_mul(input_bytes_per_sample)
            .context("CUE PCM frame bytes 溢出")?;
        let start = offset_frames
            .checked_mul(input_frame_bytes)
            .context("CUE PCM slice start 溢出")?;
        let len = frames
            .checked_mul(input_frame_bytes)
            .context("CUE PCM slice length 溢出")?;
        let end = start.checked_add(len).context("CUE PCM slice end 溢出")?;
        ensure!(end <= payload.len(), "CUE PCM frame payload 越界");
        let source = &payload[start..end];

        match (self.format.storage_bits, self.output_storage_bits) {
            (16, 16) => {
                for chunk in source.chunks_exact(2) {
                    let value = i16::from_ne_bytes([chunk[0], chunk[1]]);
                    self.file.write_all(&value.to_le_bytes())?;
                }
            }
            (32, 32) => {
                for chunk in source.chunks_exact(4) {
                    let value = i32::from_ne_bytes(chunk.try_into().unwrap());
                    self.file.write_all(&value.to_le_bytes())?;
                }
            }
            (32, 24) => {
                for chunk in source.chunks_exact(4) {
                    let value = i32::from_ne_bytes(chunk.try_into().unwrap());
                    ensure!(value & 0xff == 0, "24-bit WAV 转换发现非零低 8 bit");
                    let packed = (value >> 8).to_le_bytes();
                    self.file.write_all(&packed[..3])?;
                }
            }
            (32, 16) => {
                for chunk in source.chunks_exact(4) {
                    let value = i32::from_ne_bytes(chunk.try_into().unwrap());
                    ensure!(value & 0xffff == 0, "16-bit WAV 转换发现非零低 16 bit");
                    self.file.write_all(&(value >> 16).to_le_bytes()[..2])?;
                }
            }
            pair => bail!("WAV PCM 位宽转换不支持: {} -> {}", pair.0, pair.1),
        }

        let written = u64::try_from(frames)?
            .checked_mul(u64::from(self.format.channels))
            .and_then(|samples| samples.checked_mul(u64::from(self.output_storage_bits / 8)))
            .context("WAV data size 溢出")?;
        self.data_bytes = self
            .data_bytes
            .checked_add(written)
            .context("WAV data size 溢出")?;
        Ok(())
    }

    fn finish(mut self) -> Result<()> {
        let data_size = u32::try_from(self.data_bytes).context("WAV data 超过 RIFF 4 GiB 上限")?;
        let file_len = self.file.stream_position()?;
        let riff_size = u32::try_from(file_len.checked_sub(8).context("WAV file size 无效")?)
            .context("WAV RIFF 超过 4 GiB 上限")?;
        self.file.seek(SeekFrom::Start(4))?;
        self.file.write_all(&riff_size.to_le_bytes())?;
        self.file.seek(SeekFrom::Start(self.data_size_pos))?;
        self.file.write_all(&data_size.to_le_bytes())?;
        self.file.flush()?;
        Ok(())
    }
}

/// 从 canonical CUE 原始 75 fps 边界生成双声道整数 PCM WAV。
pub fn extract_cue_track_to_wav(
    cue_path: &Path,
    track_num: u16,
    output_path: &Path,
) -> Result<CueWavResult> {
    let cue = CueSheet::parse_file(cue_path)
        .with_context(|| format!("解析 CUE 失败: {}", cue_path.display()))?;
    let track = cue
        .tracks
        .iter()
        .find(|track| track.track_num == track_num)
        .context("CUE 轨道不存在")?;
    let part = prepare_output(output_path)?;
    let result = (|| -> Result<CueWavResult> {
        let mut decoder = DirectPcmDecoder::open_local(&track.physical_path)?;
        let mut frame = DirectPcmFrame::new()?;
        let mut writer: Option<WavWriter> = None;
        let mut format: Option<DirectPcmFormat> = None;
        let mut decoded_samples = 0_u64;
        let mut written_samples = 0_u64;
        let mut start_sample = 0_u64;
        let mut end_sample: Option<u64> = None;

        while decoder.read_frame(&mut frame)? {
            let current_format = frame.format()?;
            if let Some(expected) = format {
                ensure!(
                    expected == current_format,
                    "CUE 母版播放中 PCM 格式发生变化"
                );
            } else {
                ensure!(current_format.channels == 2, "UPnP CUE 仅支持双声道");
                start_sample = cue_frame_to_sample(
                    u64::from(track.cue_start_frames),
                    current_format.sample_rate,
                )?;
                end_sample = track
                    .cue_duration_frames
                    .map(|duration| {
                        cue_frame_to_sample(
                            u64::from(track.cue_start_frames) + u64::from(duration),
                            current_format.sample_rate,
                        )
                    })
                    .transpose()?;
                writer = Some(WavWriter::create(&part, current_format)?);
                format = Some(current_format);
            }

            let frame_samples = u64::try_from(frame.samples_per_channel())?;
            let frame_start = decoded_samples;
            let frame_end = frame_start
                .checked_add(frame_samples)
                .context("CUE decoded sample count 溢出")?;
            let overlap_start = frame_start.max(start_sample);
            let overlap_end = end_sample.map_or(frame_end, |end| frame_end.min(end));
            if overlap_end > overlap_start {
                let offset = usize::try_from(overlap_start - frame_start)?;
                let count = usize::try_from(overlap_end - overlap_start)?;
                writer
                    .as_mut()
                    .context("CUE WAV writer 未初始化")?
                    .write_frames(frame.payload_bytes()?, offset, count)?;
                written_samples = written_samples
                    .checked_add(u64::try_from(count)?)
                    .context("CUE output sample count 溢出")?;
            }
            decoded_samples = frame_end;
            if end_sample.is_some_and(|end| decoded_samples >= end) {
                break;
            }
        }

        let format = format.context("CUE 母版没有可解码 PCM")?;
        ensure!(decoded_samples > start_sample, "CUE 起点超出母版末尾");
        if let Some(end) = end_sample {
            ensure!(decoded_samples >= end, "CUE 母版在分轨结束前提前 EOF");
            ensure!(
                written_samples == end - start_sample,
                "CUE 输出样本数与边界不一致"
            );
        }
        ensure!(written_samples > 0, "CUE 分轨没有 PCM samples");
        writer.context("CUE WAV writer 未初始化")?.finish()?;
        let output_storage_bits = wav_storage_bits(format.valid_bits)?;
        let duration_ms = written_samples
            .checked_mul(1000)
            .and_then(|value| value.checked_add(u64::from(format.sample_rate) / 2))
            .context("CUE duration 溢出")?
            / u64::from(format.sample_rate);
        Ok(CueWavResult {
            sample_rate: format.sample_rate,
            channels: format.channels,
            valid_bits: format.valid_bits,
            storage_bits: output_storage_bits,
            samples_per_channel: written_samples,
            duration_ms,
        })
    })();
    match result {
        Ok(value) => {
            publish_output(&part, output_path)?;
            Ok(value)
        }
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}

const DSF_BLOCK_SIZE: usize = 4096;
const DSD_SILENCE_MSB: u8 = 0x69;

struct DsfWriter {
    file: File,
    data_size_pos: u64,
    expected_bytes_per_channel: u64,
    written_bytes_per_channel: u64,
    stored_data_bytes: u64,
    left: Vec<u8>,
    right: Vec<u8>,
}

impl DsfWriter {
    fn create(path: &Path, sample_rate: u32, bits_per_channel: u64) -> Result<Self> {
        ensure!(sample_rate > 0, "DSF sample rate 无效");
        ensure!(
            bits_per_channel > 0 && bits_per_channel % 8 == 0,
            "DSF logical bit count 必须按完整 byte 对齐"
        );
        let expected_bytes_per_channel = bits_per_channel / 8;
        let mut file =
            File::create(path).with_context(|| format!("创建 DSF 失败: {}", path.display()))?;
        file.write_all(b"DSD ")?;
        file.write_all(&28_u64.to_le_bytes())?;
        file.write_all(&0_u64.to_le_bytes())?;
        file.write_all(&0_u64.to_le_bytes())?;
        file.write_all(b"fmt ")?;
        file.write_all(&52_u64.to_le_bytes())?;
        file.write_all(&1_u32.to_le_bytes())?;
        file.write_all(&0_u32.to_le_bytes())?;
        file.write_all(&2_u32.to_le_bytes())?;
        file.write_all(&2_u32.to_le_bytes())?;
        file.write_all(&sample_rate.to_le_bytes())?;
        file.write_all(&1_u32.to_le_bytes())?;
        file.write_all(&bits_per_channel.to_le_bytes())?;
        file.write_all(&(DSF_BLOCK_SIZE as u32).to_le_bytes())?;
        file.write_all(&0_u32.to_le_bytes())?;
        file.write_all(b"data")?;
        let data_size_pos = file.stream_position()?;
        file.write_all(&0_u64.to_le_bytes())?;
        Ok(Self {
            file,
            data_size_pos,
            expected_bytes_per_channel,
            written_bytes_per_channel: 0,
            stored_data_bytes: 0,
            left: Vec::with_capacity(DSF_BLOCK_SIZE),
            right: Vec::with_capacity(DSF_BLOCK_SIZE),
        })
    }

    fn flush_block(&mut self, final_block: bool) -> Result<()> {
        ensure!(
            self.left.len() == self.right.len(),
            "DSF 声道 block 长度不一致"
        );
        if self.left.is_empty() {
            return Ok(());
        }
        ensure!(
            final_block || self.left.len() == DSF_BLOCK_SIZE,
            "DSF 非末尾 block 长度不足"
        );
        let mut stored = Vec::with_capacity(DSF_BLOCK_SIZE * 2);
        for channel in [&self.left, &self.right] {
            stored.extend(channel.iter().map(|byte| reverse_byte(*byte)));
            stored.extend(std::iter::repeat_n(
                reverse_byte(DSD_SILENCE_MSB),
                DSF_BLOCK_SIZE - channel.len(),
            ));
        }
        self.file.write_all(&stored)?;
        self.stored_data_bytes = self
            .stored_data_bytes
            .checked_add(u64::try_from(stored.len())?)
            .context("DSF data size 溢出")?;
        self.left.clear();
        self.right.clear();
        Ok(())
    }

    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        ensure!(bytes.len() % 2 == 0, "双声道 DSF 输入必须按 L/R byte 对齐");
        for pair in bytes.chunks_exact(2) {
            ensure!(
                self.written_bytes_per_channel < self.expected_bytes_per_channel,
                "DSF 输入超过声明的 logical bit count"
            );
            self.left.push(pair[0]);
            self.right.push(pair[1]);
            self.written_bytes_per_channel += 1;
            if self.left.len() == DSF_BLOCK_SIZE {
                self.flush_block(false)?;
            }
        }
        Ok(())
    }

    fn finish(mut self) -> Result<()> {
        ensure!(
            self.written_bytes_per_channel == self.expected_bytes_per_channel,
            "DSF 输入长度与声明的 logical bit count 不一致"
        );
        self.flush_block(true)?;
        let file_len = self.file.stream_position()?;
        let data_size = self
            .stored_data_bytes
            .checked_add(12)
            .context("DSF data chunk size 溢出")?;
        self.file.seek(SeekFrom::Start(12))?;
        self.file.write_all(&file_len.to_le_bytes())?;
        self.file.seek(SeekFrom::Start(self.data_size_pos))?;
        self.file.write_all(&data_size.to_le_bytes())?;
        self.file.flush()?;
        Ok(())
    }
}

fn cue_frame_to_dsd_bit(frame75: u64, sample_rate: u32) -> Result<u64> {
    let numerator = frame75
        .checked_mul(u64::from(sample_rate))
        .context("DSD CUE bit boundary 溢出")?;
    ensure!(
        numerator % 75 == 0,
        "DSD CUE 75fps 边界不能精确映射到 source bit grid"
    );
    Ok(numerator / 75)
}

fn cue_dsd_range(
    track_start_frames: u32,
    track_duration_frames: Option<u32>,
    sample_rate: u32,
    total_bits_per_channel: u64,
) -> Result<(u64, u64)> {
    let start = cue_frame_to_dsd_bit(u64::from(track_start_frames), sample_rate)?;
    let end = match track_duration_frames {
        Some(duration) => cue_frame_to_dsd_bit(
            u64::from(track_start_frames)
                .checked_add(u64::from(duration))
                .context("DSD CUE end frame 溢出")?,
            sample_rate,
        )?,
        None => total_bits_per_channel,
    };
    ensure!(end > start, "DSD CUE 分轨范围为空");
    ensure!(
        end <= total_bits_per_channel,
        "DSD CUE 分轨超出母版有效 bit 范围"
    );
    ensure!(
        start % 8 == 0 && end % 8 == 0,
        "DSD CUE 边界不能无损表示为 DFF byte stream"
    );
    Ok((start, end))
}

#[derive(Debug, Clone, Copy)]
struct DffMediaInfo {
    sample_rate: u32,
    channels: u16,
    data_offset: u64,
    data_size: u64,
}

fn parse_dff_media_info(source_path: &Path) -> Result<DffMediaInfo> {
    let mut file = File::open(source_path)
        .with_context(|| format!("打开 DFF 母版失败: {}", source_path.display()))?;
    let file_len = file.metadata()?.len();
    let mut form = [0_u8; 16];
    file.read_exact(&mut form).context("读取 DFF FRM8 失败")?;
    ensure!(
        &form[..4] == b"FRM8" && &form[12..16] == b"DSD ",
        "DFF FORM 类型无效"
    );

    let mut sample_rate = None;
    let mut channels = None;
    let mut raw_dsd = None;
    let mut data = None;
    while file.stream_position()?.saturating_add(12) <= file_len {
        let mut header = [0_u8; 12];
        file.read_exact(&mut header)?;
        let size = u64::from_be_bytes(header[4..12].try_into().unwrap());
        let payload_pos = file.stream_position()?;
        let payload_end = payload_pos
            .checked_add(size)
            .context("DFF chunk size 溢出")?;
        ensure!(payload_end <= file_len, "DFF chunk 越界");
        match &header[..4] {
            b"PROP" => {
                let mut payload = vec![0_u8; usize::try_from(size)?];
                file.read_exact(&mut payload)?;
                ensure!(
                    payload.len() >= 4 && &payload[..4] == b"SND ",
                    "DFF PROP 类型无效"
                );
                let mut pos = 4usize;
                while pos + 12 <= payload.len() {
                    let id = &payload[pos..pos + 4];
                    let sub_size = usize::try_from(u64::from_be_bytes(
                        payload[pos + 4..pos + 12].try_into().unwrap(),
                    ))?;
                    let start = pos + 12;
                    let end = start.checked_add(sub_size).context("DFF PROP chunk 溢出")?;
                    ensure!(end <= payload.len(), "DFF PROP chunk 越界");
                    match id {
                        b"FS  " if sub_size >= 4 => {
                            sample_rate = Some(u32::from_be_bytes(
                                payload[start..start + 4].try_into().unwrap(),
                            ));
                        }
                        b"CHNL" if sub_size >= 2 => {
                            channels = Some(u16::from_be_bytes(
                                payload[start..start + 2].try_into().unwrap(),
                            ));
                        }
                        b"CMPR" if sub_size >= 4 => {
                            raw_dsd = Some(&payload[start..start + 4] == b"DSD ");
                        }
                        _ => {}
                    }
                    pos = end + (sub_size % 2);
                }
            }
            b"DSD " => {
                data = Some((payload_pos, size));
                break;
            }
            _ => {
                file.seek(SeekFrom::Start(payload_end))?;
            }
        }
        if size % 2 != 0 {
            file.seek(SeekFrom::Current(1))?;
        }
    }

    let sample_rate = sample_rate.context("DFF 缺少 FS sample rate")?;
    let channels = channels.context("DFF 缺少 CHNL")?;
    ensure!(channels == 2, "UPnP DSD CUE 仅支持双声道");
    ensure!(raw_dsd == Some(true), "DFF CUE 仅支持未压缩 DSD payload");
    let (data_offset, data_size) = data.context("DFF 缺少 DSD chunk")?;
    ensure!(
        data_size > 0 && data_size % 2 == 0,
        "DFF payload 不是完整双声道 byte stream"
    );
    Ok(DffMediaInfo {
        sample_rate,
        channels,
        data_offset,
        data_size,
    })
}

fn copy_dff_range(
    source_path: &Path,
    reader: &DffMediaInfo,
    start_bits: u64,
    end_bits: u64,
    mut write: impl FnMut(&[u8]) -> Result<()>,
) -> Result<()> {
    ensure!(reader.channels == 2, "UPnP DSD CUE 仅支持双声道");
    let start_per_channel = start_bits / 8;
    let bytes_per_channel = (end_bits - start_bits) / 8;
    let byte_offset = start_per_channel
        .checked_mul(2)
        .context("DFF CUE byte offset 溢出")?;
    let total_bytes = bytes_per_channel
        .checked_mul(2)
        .context("DFF CUE byte length 溢出")?;
    ensure!(
        byte_offset
            .checked_add(total_bytes)
            .context("DFF CUE range 溢出")?
            <= reader.data_size,
        "DFF CUE range 超出 DSD chunk"
    );

    let mut file = File::open(source_path)
        .with_context(|| format!("打开 DFF CUE 母版失败: {}", source_path.display()))?;
    file.seek(SeekFrom::Start(
        reader
            .data_offset
            .checked_add(byte_offset)
            .context("DFF CUE file offset 溢出")?,
    ))?;
    let mut remaining = total_bytes;
    let mut buffer = vec![0_u8; 128 * 1024];
    while remaining > 0 {
        let count = usize::try_from(remaining.min(buffer.len() as u64))?;
        file.read_exact(&mut buffer[..count])?;
        write(&buffer[..count])?;
        remaining -= u64::try_from(count)?;
    }
    Ok(())
}

fn copy_dsf_range(
    source_path: &Path,
    reader: &DsfReader,
    start_bits: u64,
    end_bits: u64,
    mut write: impl FnMut(&[u8]) -> Result<()>,
) -> Result<()> {
    ensure!(reader.channels == 2, "UPnP DSD CUE 仅支持双声道");
    let block_size = u64::from(reader.block_size);
    ensure!(block_size > 0, "DSF block size 无效");
    let start_per_channel = start_bits / 8;
    let mut remaining_per_channel = (end_bits - start_bits) / 8;
    let block_index = start_per_channel / block_size;
    let mut offset_in_block = usize::try_from(start_per_channel % block_size)?;
    let stored_group = block_size.checked_mul(2).context("DSF stored group 溢出")?;
    let stored_offset = block_index
        .checked_mul(stored_group)
        .context("DSF CUE stored offset 溢出")?;
    ensure!(
        stored_offset < reader.data_size,
        "DSF CUE 起点超出 data chunk"
    );

    let mut file = File::open(source_path)
        .with_context(|| format!("打开 DSF CUE 母版失败: {}", source_path.display()))?;
    file.seek(SeekFrom::Start(
        reader
            .data_offset
            .checked_add(stored_offset)
            .context("DSF CUE file offset 溢出")?,
    ))?;
    let block_size_usize = usize::try_from(block_size)?;
    let stored_group_usize = usize::try_from(stored_group)?;
    let mut stored = vec![0_u8; stored_group_usize];
    let mut interleaved = Vec::with_capacity(block_size_usize * 2);

    while remaining_per_channel > 0 {
        file.read_exact(&mut stored)
            .context("DSF CUE 母版在分轨结束前提前 EOF")?;
        let available = block_size_usize
            .checked_sub(offset_in_block)
            .context("DSF CUE block offset 越界")?;
        let take = usize::try_from(remaining_per_channel.min(available as u64))?;
        interleaved.clear();
        interleaved.reserve(take * 2);
        for index in 0..take {
            let source_index = offset_in_block + index;
            interleaved.push(reverse_byte(stored[source_index]));
            interleaved.push(reverse_byte(stored[block_size_usize + source_index]));
        }
        write(&interleaved)?;
        remaining_per_channel -= u64::try_from(take)?;
        offset_in_block = 0;
    }
    Ok(())
}

/// 从 CUE 的 75fps 边界裁出 Native DSD，并写为逻辑序列等价的双声道 DSF。
pub fn extract_cue_track_to_dsf(
    cue_path: &Path,
    track_num: u16,
    output_path: &Path,
) -> Result<DsdExtractResult> {
    let cue = CueSheet::parse_file(cue_path)
        .with_context(|| format!("解析 DSD CUE 失败: {}", cue_path.display()))?;
    let track = cue
        .tracks
        .iter()
        .find(|track| track.track_num == track_num)
        .context("DSD CUE 轨道不存在")?;
    let extension = track
        .physical_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let part = prepare_output(output_path)?;
    let result = (|| -> Result<DsdExtractResult> {
        let (sample_rate, total_bits, source_kind) = match extension.as_str() {
            "dsf" => {
                let reader = DsfReader::open(&track.physical_path)?;
                ensure!(reader.channels == 2, "UPnP DSD CUE 仅支持双声道");
                (reader.sample_rate, reader.sample_count, 0_u8)
            }
            "dff" | "dsdiff" => {
                let reader = parse_dff_media_info(&track.physical_path)?;
                let total_bits = reader
                    .data_size
                    .checked_div(2)
                    .and_then(|bytes| bytes.checked_mul(8))
                    .context("DFF logical bit count 溢出")?;
                (reader.sample_rate, total_bits, 1_u8)
            }
            _ => bail!("DSD CUE 母版必须是 DSF/DFF"),
        };
        let (start_bits, end_bits) = cue_dsd_range(
            track.cue_start_frames,
            track.cue_duration_frames,
            sample_rate,
            total_bits,
        )?;
        let bits_per_channel = end_bits - start_bits;
        let mut writer = DsfWriter::create(&part, sample_rate, bits_per_channel)?;
        match source_kind {
            0 => {
                let reader = DsfReader::open(&track.physical_path)?;
                copy_dsf_range(
                    &track.physical_path,
                    &reader,
                    start_bits,
                    end_bits,
                    |bytes| writer.write(bytes),
                )?;
            }
            1 => {
                let reader = parse_dff_media_info(&track.physical_path)?;
                copy_dff_range(
                    &track.physical_path,
                    &reader,
                    start_bits,
                    end_bits,
                    |bytes| writer.write(bytes),
                )?;
            }
            _ => unreachable!(),
        }
        writer.finish()?;
        let duration_ms = bits_per_channel
            .checked_mul(1000)
            .and_then(|value| value.checked_add(u64::from(sample_rate) / 2))
            .context("DSD CUE duration 溢出")?
            / u64::from(sample_rate);
        Ok(DsdExtractResult {
            sample_rate,
            channels: 2,
            bits_per_channel,
            duration_ms,
        })
    })();
    match result {
        Ok(value) => {
            publish_output(&part, output_path)?;
            Ok(value)
        }
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}

/// 复用现有 stereo SACD reader，把一个完整轨道写成双声道 DSF。
pub fn extract_sacd_track_to_dsf(
    iso_path: &Path,
    track_num: u16,
    output_path: &Path,
) -> Result<DsdExtractResult> {
    let mut reader = SacdTrackReader::open_track(iso_path, track_num)?;
    ensure!(reader.channels == 2, "UPnP SACD 仅支持双声道");
    ensure!(
        !reader.track.is_dst,
        "UPnP compressed DST 需要独立 correctness gate，通过前明确不支持"
    );
    let sample_rate = reader.sample_rate;
    ensure!(
        sample_rate % 75 == 0,
        "SACD sample rate 不能映射 75fps 轨道边界"
    );
    let bits_per_channel = u64::from(reader.total_frames)
        .checked_mul(u64::from(sample_rate) / 75)
        .context("SACD expected bit count 溢出")?;
    let part = prepare_output(output_path)?;
    let result = (|| -> Result<DsdExtractResult> {
        let mut writer = DsfWriter::create(&part, sample_rate, bits_per_channel)?;
        let mut buffer = vec![0_u8; 128 * 1024];
        loop {
            let read = reader.read_interleaved_dsd(&mut buffer)?;
            if read == 0 {
                break;
            }
            writer.write(&buffer[..read])?;
        }
        writer.finish()?;
        let duration_ms = bits_per_channel
            .checked_mul(1000)
            .and_then(|value| value.checked_add(u64::from(sample_rate) / 2))
            .context("SACD duration 溢出")?
            / u64::from(sample_rate);
        Ok(DsdExtractResult {
            sample_rate,
            channels: 2,
            bits_per_channel,
            duration_ms,
        })
    })();
    match result {
        Ok(value) => {
            publish_output(&part, output_path)?;
            Ok(value)
        }
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}
