//! SACD 双声道音轨读取器；输出逐字节 L/R 交错、MSB-first 的原始 DSD。

use anyhow::{ensure, Context, Result};
use std::path::Path;

use super::dst::{DstDecoder, BYTES_PER_FRAME_CHANNEL};
use super::iso_reader::{IsoReader, SACD_SECTOR_SIZE};
use super::scarletbook::{AreaType, SacdDisc, SacdTrack, SACD_FRAME_RATE, SACD_SAMPLING_FREQUENCY};
use crate::dsd::DsdRate;

const FRAME_BYTES: usize = BYTES_PER_FRAME_CHANNEL * 2;
const MAX_DST_BYTES: usize = 64 * 1024;

/// 仅读取双声道区域；公开输出不采用 SDK 的四字节声道分组或 LSB 位序。
pub struct SacdTrackReader {
    pub iso_reader: IsoReader,
    pub track: SacdTrack,
    pub sample_rate: u32,
    pub channels: u16,
    pub dsd_rate: DsdRate,
    pub total_frames: u32,
    /// 已完整解包的音频帧数，不是已读取的扇区数。
    pub current_frame: u32,
    pub duration_seconds: f64,

    dst_decoder: Option<DstDecoder>,
    current_sector: u32,
    end_sector: u32,
    frame_buf: Vec<u8>,
    frame_started: bool,
    dst_packets_remaining: u8,
    residual_buf: Vec<u8>,
    residual_pos: usize,
    failed: bool,
}

impl SacdTrackReader {
    /// 打开双声道轨道；多声道区域不会作为缺失双声道区域的替代。
    pub fn open_track<P: AsRef<Path>>(iso_path: P, track_num: u16) -> Result<Self> {
        Self::open_track_in_area(iso_path, track_num, AreaType::Stereo)
    }

    /// 按明确区域打开轨道；当前仅支持双声道。
    pub fn open_track_in_area<P: AsRef<Path>>(
        iso_path: P,
        track_num: u16,
        area_type: AreaType,
    ) -> Result<Self> {
        ensure!(
            area_type == AreaType::Stereo,
            "SACD 多声道不支持，仅支持双声道"
        );
        let mut iso_reader = IsoReader::open(iso_path)?;
        let disc = SacdDisc::parse(&mut iso_reader)?;
        let area = disc
            .stereo_area_idx
            .and_then(|idx| disc.areas.get(idx))
            .context("SACD 双声道区域不存在，多声道不支持")?;
        ensure!(
            area.area_type == AreaType::Stereo && area.channel_count == 2,
            "SACD 仅支持双声道，区域声道数不支持"
        );
        ensure!(
            matches!(area.frame_format, 0 | 2 | 3),
            "SACD 区域帧编码不支持"
        );
        let track = area
            .tracks
            .iter()
            .find(|track| track.track_num == track_num)
            .cloned()
            .context("SACD 双声道轨道不存在")?;
        ensure!(track.channels == 2, "SACD 多声道不支持，仅支持双声道");
        ensure!(
            track.duration_frame > 0 && track.length_lsn > 0,
            "SACD 轨道范围为空"
        );
        let end_sector = track
            .start_lsn
            .checked_add(track.length_lsn)
            .context("SACD 轨道范围溢出")?;
        ensure!(
            end_sector <= iso_reader.total_sectors,
            "SACD 轨道超出镜像范围"
        );
        Ok(Self {
            iso_reader,
            sample_rate: SACD_SAMPLING_FREQUENCY,
            channels: 2,
            dsd_rate: DsdRate::Dsd64,
            total_frames: track.duration_frame,
            current_frame: 0,
            duration_seconds: track.duration,
            dst_decoder: track.is_dst.then(|| DstDecoder::new(2)),
            current_sector: track.start_lsn,
            end_sector,
            track,
            frame_buf: Vec::with_capacity(MAX_DST_BYTES),
            frame_started: false,
            dst_packets_remaining: 0,
            residual_buf: Vec::with_capacity(FRAME_BYTES * 7),
            residual_pos: 0,
            failed: false,
        })
    }

    /// 返回 L0/R0/L1/R1 字节顺序，字节内最早的 DSD bit 位于最高位。
    /// 任意大小的输出缓冲可拆分交错字节对；调用方必须连续消费返回的字节流。
    pub fn read_interleaved_dsd(&mut self, out_buf: &mut [u8]) -> Result<usize> {
        ensure!(!self.failed, "SACD 读取已失败，请重新打开轨道");
        let result = self.read_inner(out_buf);
        if result.is_err() {
            self.failed = true;
            self.residual_buf.clear();
            self.frame_buf.clear();
        }
        result
    }

    fn read_inner(&mut self, out_buf: &mut [u8]) -> Result<usize> {
        let mut written = 0;
        while written < out_buf.len() {
            if self.residual_pos < self.residual_buf.len() {
                let count =
                    (self.residual_buf.len() - self.residual_pos).min(out_buf.len() - written);
                out_buf[written..written + count].copy_from_slice(
                    &self.residual_buf[self.residual_pos..self.residual_pos + count],
                );
                self.residual_pos += count;
                written += count;
                continue;
            }
            self.residual_buf.clear();
            self.residual_pos = 0;
            if self.current_frame == self.total_frames {
                break;
            }
            if self.current_sector == self.end_sector {
                self.finish_frame()?;
                ensure!(
                    self.current_frame == self.total_frames,
                    "SACD 轨道提前结束，音频帧缺失"
                );
            } else {
                let mut sector = [0u8; SACD_SECTOR_SIZE];
                self.iso_reader
                    .read_sectors(self.current_sector, 1, &mut sector)?;
                self.current_sector += 1;
                self.read_sector(&sector)?;
            }
        }
        Ok(written)
    }

    fn finish_frame(&mut self) -> Result<()> {
        ensure!(
            self.frame_started && !self.frame_buf.is_empty(),
            "SACD 缺少完整音频帧"
        );
        if let Some(decoder) = &mut self.dst_decoder {
            ensure!(self.dst_packets_remaining == 0, "SACD DST 音频帧截断");
            let mut planar = [0u8; FRAME_BYTES];
            let size = decoder
                .decode_frame(&self.frame_buf, &mut planar)
                .with_context(|| format!("SACD DST 解码失败，轨内帧 {}", self.current_frame))?;
            ensure!(size == FRAME_BYTES, "SACD DST 解码结果长度错误");
            // 唯一 Rust DST decoder 返回 MSB-first planar；只交错声道，不反转音频 bit。
            for index in 0..BYTES_PER_FRAME_CHANNEL {
                self.residual_buf.push(planar[index]);
                self.residual_buf
                    .push(planar[BYTES_PER_FRAME_CHANNEL + index]);
            }
        } else {
            ensure!(
                self.frame_buf.len() == FRAME_BYTES,
                "SACD DSD 音频帧长度错误"
            );
            self.residual_buf.extend_from_slice(&self.frame_buf);
        }
        self.current_frame += 1;
        self.frame_started = false;
        self.frame_buf.clear();
        Ok(())
    }

    fn read_sector(&mut self, sector: &[u8; SACD_SECTOR_SIZE]) -> Result<()> {
        let dst = sector[0] & 1 != 0;
        let packets = usize::from(sector[0] >> 5);
        let frames = usize::from((sector[0] >> 2) & 7);
        let info_size = if dst { 4 } else { 3 };
        let info_start = 1 + packets * 2;
        let mut offset = info_start + frames * info_size;
        let mut frame_index = 0;
        ensure!(offset <= sector.len(), "SACD 扇区头越界");
        for packet in 0..packets {
            let header = sector[1 + packet * 2];
            let length = (usize::from(header & 7) << 8) | usize::from(sector[2 + packet * 2]);
            let end = offset.checked_add(length).context("SACD packet 长度溢出")?;
            ensure!(end <= sector.len(), "SACD packet 超出扇区");
            let audio = (header >> 3) & 7 == 2;
            if audio {
                ensure!(dst == self.track.is_dst, "SACD 音频编码与区域声明不一致");
                if header & 0x80 != 0 {
                    if self.frame_started {
                        self.finish_frame()?;
                    }
                    if self.current_frame == self.total_frames {
                        return Ok(());
                    }
                    ensure!(frame_index < frames, "SACD 缺少 frame info");
                    let info = info_start + frame_index * info_size;
                    ensure!(
                        sector[info + 1] < 60 && sector[info + 2] < 75,
                        "SACD 帧时间码无效"
                    );
                    let time = (u32::from(sector[info]) * 60 + u32::from(sector[info + 1])) * 75
                        + u32::from(sector[info + 2]);
                    let expected = self
                        .track
                        .start_frame
                        .checked_add(self.current_frame)
                        .context("SACD 帧时间溢出")?;
                    ensure!(time == expected, "SACD 帧时间不连续或轨道起点不匹配");
                    if dst {
                        ensure!(sector[info + 3] & 3 == 0, "SACD DST 多声道不支持");
                        self.dst_packets_remaining = (sector[info + 3] >> 2) & 31;
                        ensure!(self.dst_packets_remaining > 0, "SACD DST 帧 packet 数为空");
                    }
                    frame_index += 1;
                    self.frame_started = true;
                }
                if !self.frame_started {
                    // Track LSN 边界可能落在上一音频帧的 continuation packet 中间。
                    // 在本轨第一个 frame_start 出现前丢弃这些前导数据；一旦本轨已开始，
                    // frame_started 会在同一 packet 分支内恢复为 true，因此后续缺失起点仍会失败。
                    ensure!(
                        self.current_frame == 0 && self.frame_buf.is_empty(),
                        "SACD 音频帧缺少起始 packet"
                    );
                    offset = end;
                    continue;
                }
                let limit = if dst { MAX_DST_BYTES } else { FRAME_BYTES };
                ensure!(
                    self.frame_buf.len() + length <= limit,
                    "SACD 音频帧超出长度上限"
                );
                self.frame_buf.extend_from_slice(&sector[offset..end]);
                if dst {
                    self.dst_packets_remaining = self
                        .dst_packets_remaining
                        .checked_sub(1)
                        .context("SACD DST packet 数超出声明")?;
                }
            }
            offset = end;
        }
        ensure!(frame_index == frames, "SACD frame info 数量不匹配");
        Ok(())
    }

    /// 按 75 fps 向下对齐定位，从轨道起点逐帧跳过，避免按扇区比例猜测 DST 位置。
    pub fn seek_seconds(&mut self, target_sec: f64) -> Result<()> {
        ensure!(!self.failed, "SACD 读取已失败，请重新打开轨道");
        ensure!(
            target_sec.is_finite() && target_sec >= 0.0,
            "SACD seek 时间无效"
        );
        let target =
            ((target_sec * f64::from(SACD_FRAME_RATE)).floor() as u32).min(self.total_frames);
        self.current_sector = self.track.start_lsn;
        self.current_frame = 0;
        self.frame_buf.clear();
        self.frame_started = false;
        self.dst_packets_remaining = 0;
        self.residual_buf.clear();
        self.residual_pos = 0;
        self.dst_decoder = self.track.is_dst.then(|| DstDecoder::new(2));
        let mut discard = [0u8; FRAME_BYTES];
        for _ in 0..target {
            ensure!(
                self.read_interleaved_dsd(&mut discard)? == FRAME_BYTES,
                "SACD seek 提前结束"
            );
        }
        Ok(())
    }
}
