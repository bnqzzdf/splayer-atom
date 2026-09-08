//! Seekable DSF view over one stereo SACD virtual track.
//!
//! The SACD reader remains the sole owner of DST/DSD correctness. This adapter only
//! presents its logical MSB-first stereo DSD bytes as a standards-compliant DSF byte
//! stream so existing FFmpeg and Native DSD consumers can pull on demand without
//! materializing the whole track first.

use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use anyhow::{ensure, Context, Result};

use crate::dsd::reverse_byte;

use super::{parse_sacd_virtual_path, SacdTrackReader, SACD_FRAME_RATE};

pub const DSF_BLOCK_SIZE: usize = 4096;
const DSF_CHANNELS: usize = 2;
const DSF_HEADER_LEN: usize = 92;
const DSF_STORED_BLOCK: usize = DSF_BLOCK_SIZE * DSF_CHANNELS;
const DSD_SILENCE_LSB: u8 = 0x96; // reverse_byte(0x69)

fn io_other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}

/// A virtual, seekable DSF file backed by `SacdTrackReader`.
///
/// Reads are lazy. Sequential reads keep the SACD reader moving forward; random DSF
/// block reads reposition the SACD reader to the exact logical byte represented by
/// that block before decoding it.
pub struct SacdDsfStream {
    reader: SacdTrackReader,
    header: [u8; DSF_HEADER_LEN],
    position: u64,
    file_len: u64,
    bytes_per_frame_channel: u64,
    logical_bytes_per_channel: u64,
    reader_next_byte_per_channel: u64,
    cached_block_index: Option<u64>,
    cached_block: Vec<u8>,
    interleaved: Vec<u8>,
    discard: Vec<u8>,
}

impl SacdDsfStream {
    pub fn open_virtual_path(source: &str) -> Result<Self> {
        let info = parse_sacd_virtual_path(source).context("SACD virtual track path 无效")?;
        Self::open(&info.iso_path, info.track_num)
    }

    pub fn open<P: AsRef<Path>>(iso_path: P, track_num: u16) -> Result<Self> {
        let reader = SacdTrackReader::open_track(iso_path, track_num)?;
        ensure!(reader.channels == 2, "SACD virtual DSF 仅支持双声道");
        let rate = u64::from(reader.sample_rate);
        let frame_divisor = u64::from(SACD_FRAME_RATE) * 8;
        ensure!(
            rate > 0 && rate % frame_divisor == 0,
            "SACD sample rate 无法精确映射 75fps byte grid"
        );
        let bytes_per_frame_channel = rate / frame_divisor;
        let logical_bytes_per_channel = u64::from(reader.total_frames)
            .checked_mul(bytes_per_frame_channel)
            .context("SACD logical byte count 溢出")?;
        ensure!(logical_bytes_per_channel > 0, "SACD virtual DSF 音轨为空");
        let bits_per_channel = logical_bytes_per_channel
            .checked_mul(8)
            .context("SACD logical bit count 溢出")?;
        let blocks = logical_bytes_per_channel.div_ceil(DSF_BLOCK_SIZE as u64);
        let stored_data_bytes = blocks
            .checked_mul(DSF_STORED_BLOCK as u64)
            .context("SACD virtual DSF payload size 溢出")?;
        let file_len = (DSF_HEADER_LEN as u64)
            .checked_add(stored_data_bytes)
            .context("SACD virtual DSF file size 溢出")?;
        let header = build_header(
            reader.sample_rate,
            bits_per_channel,
            stored_data_bytes,
            file_len,
        );

        Ok(Self {
            reader,
            header,
            position: 0,
            file_len,
            bytes_per_frame_channel,
            logical_bytes_per_channel,
            reader_next_byte_per_channel: 0,
            cached_block_index: None,
            cached_block: vec![DSD_SILENCE_LSB; DSF_STORED_BLOCK],
            interleaved: Vec::with_capacity(DSF_STORED_BLOCK),
            discard: Vec::new(),
        })
    }

    pub fn len(&self) -> u64 {
        self.file_len
    }

    pub fn logical_bytes_per_channel(&self) -> u64 {
        self.logical_bytes_per_channel
    }

    fn reset_reader_to_byte(&mut self, target: u64) -> io::Result<()> {
        if target == self.reader_next_byte_per_channel {
            return Ok(());
        }
        if target > self.logical_bytes_per_channel {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "SACD virtual DSF seek 超出 logical audio range",
            ));
        }
        let frame = target / self.bytes_per_frame_channel;
        let in_frame = target % self.bytes_per_frame_channel;
        let frame = u32::try_from(frame).map_err(io_other)?;
        self.reader.seek_frame(frame).map_err(io_other)?;
        if in_frame > 0 {
            let discard_len = usize::try_from(in_frame.checked_mul(2).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "SACD discard length 溢出")
            })?)
            .map_err(io_other)?;
            self.discard.resize(discard_len, 0);
            let got = self
                .reader
                .read_interleaved_dsd(&mut self.discard)
                .map_err(io_other)?;
            if got != discard_len {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "SACD virtual DSF seek 在目标 byte 前提前结束",
                ));
            }
        }
        self.reader_next_byte_per_channel = target;
        Ok(())
    }

    fn ensure_block(&mut self, block_index: u64) -> io::Result<()> {
        if self.cached_block_index == Some(block_index) {
            return Ok(());
        }
        let block_start = block_index
            .checked_mul(DSF_BLOCK_SIZE as u64)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "DSF block offset 溢出"))?;
        if block_start >= self.logical_bytes_per_channel {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "DSF block 超出 SACD logical audio",
            ));
        }
        self.reset_reader_to_byte(block_start)?;
        let valid_per_channel = usize::try_from(
            (self.logical_bytes_per_channel - block_start).min(DSF_BLOCK_SIZE as u64),
        )
        .map_err(io_other)?;
        let logical_len = valid_per_channel
            .checked_mul(2)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "SACD block size 溢出"))?;
        self.interleaved.resize(logical_len, 0);
        let got = self
            .reader
            .read_interleaved_dsd(&mut self.interleaved)
            .map_err(io_other)?;
        if got != logical_len {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "SACD virtual DSF block 在轨道结束前提前 EOF",
            ));
        }

        self.cached_block.fill(DSD_SILENCE_LSB);
        for index in 0..valid_per_channel {
            self.cached_block[index] = reverse_byte(self.interleaved[index * 2]);
            self.cached_block[DSF_BLOCK_SIZE + index] =
                reverse_byte(self.interleaved[index * 2 + 1]);
        }
        self.reader_next_byte_per_channel = block_start + valid_per_channel as u64;
        self.cached_block_index = Some(block_index);
        Ok(())
    }
}

impl Read for SacdDsfStream {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() || self.position >= self.file_len {
            return Ok(0);
        }
        let mut written = 0usize;
        while written < output.len() && self.position < self.file_len {
            if self.position < DSF_HEADER_LEN as u64 {
                let start = usize::try_from(self.position).map_err(io_other)?;
                let take = (DSF_HEADER_LEN - start).min(output.len() - written);
                output[written..written + take].copy_from_slice(&self.header[start..start + take]);
                self.position += take as u64;
                written += take;
                continue;
            }

            let data_pos = self.position - DSF_HEADER_LEN as u64;
            let block_index = data_pos / DSF_STORED_BLOCK as u64;
            let block_offset =
                usize::try_from(data_pos % DSF_STORED_BLOCK as u64).map_err(io_other)?;
            self.ensure_block(block_index)?;
            let take = (DSF_STORED_BLOCK - block_offset).min(output.len() - written);
            output[written..written + take]
                .copy_from_slice(&self.cached_block[block_offset..block_offset + take]);
            self.position += take as u64;
            written += take;
        }
        Ok(written)
    }
}

impl Seek for SacdDsfStream {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let base = match position {
            SeekFrom::Start(value) => {
                self.position = value;
                return Ok(self.position);
            }
            SeekFrom::Current(_) => i128::from(self.position),
            SeekFrom::End(_) => i128::from(self.file_len),
        };
        let delta = match position {
            SeekFrom::Current(value) | SeekFrom::End(value) => i128::from(value),
            SeekFrom::Start(_) => unreachable!(),
        };
        let next = base + delta;
        if next < 0 || next > i128::from(u64::MAX) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "SACD virtual DSF seek 位置无效",
            ));
        }
        self.position = next as u64;
        Ok(self.position)
    }
}

fn build_header(
    sample_rate: u32,
    bits_per_channel: u64,
    stored_data_bytes: u64,
    file_len: u64,
) -> [u8; DSF_HEADER_LEN] {
    let mut header = Vec::with_capacity(DSF_HEADER_LEN);
    header.extend_from_slice(b"DSD ");
    header.extend_from_slice(&28_u64.to_le_bytes());
    header.extend_from_slice(&file_len.to_le_bytes());
    header.extend_from_slice(&0_u64.to_le_bytes());
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&52_u64.to_le_bytes());
    header.extend_from_slice(&1_u32.to_le_bytes());
    header.extend_from_slice(&0_u32.to_le_bytes());
    header.extend_from_slice(&2_u32.to_le_bytes());
    header.extend_from_slice(&2_u32.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&1_u32.to_le_bytes());
    header.extend_from_slice(&bits_per_channel.to_le_bytes());
    header.extend_from_slice(&(DSF_BLOCK_SIZE as u32).to_le_bytes());
    header.extend_from_slice(&0_u32.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&(stored_data_bytes + 12).to_le_bytes());
    header.try_into().expect("DSF header size is fixed")
}
