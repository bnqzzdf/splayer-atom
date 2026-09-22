//! MPEG-4 DST (Direct Stream Transfer) frame decoder.
//!
//! The decoding model follows FFmpeg `libavcodec/dstdec.c` (Peter Ross,
//! LGPL-2.1-or-later), translated to safe Rust and stopped at the reconstructed
//! DSD stage instead of converting DSD to PCM. The public contract is planar,
//! MSB-first DSD: one complete 4704-byte DSD64 frame per channel.

use anyhow::{anyhow, ensure, Result};

pub const SAMPLES_PER_FRAME_CHANNEL: usize = 588 * 64; // 37632 one-bit samples
pub const BYTES_PER_FRAME_CHANNEL: usize = SAMPLES_PER_FRAME_CHANNEL / 8; // 4704 bytes
pub const MAX_CHANNELS: usize = 6;
const MAX_ELEMENTS: usize = 2 * MAX_CHANNELS;
const MAX_COEFFS: usize = 128;
const FILTER_BYTES: usize = 16;

const FSETS_CODE_PRED_COEFF: [[i32; 3]; 3] = [[-8, 0, 0], [-16, 8, 0], [-9, -5, 6]];
const PROBS_CODE_PRED_COEFF: [[i32; 3]; 3] = [[-8, 0, 0], [-16, 8, 0], [-24, 24, -8]];

struct BitReader<'a> {
    data: &'a [u8],
    bit_pos: usize,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, bit_pos: 0 }
    }

    fn bits_left(&self) -> usize {
        self.data
            .len()
            .saturating_mul(8)
            .saturating_sub(self.bit_pos)
    }

    fn read_bit(&mut self) -> Result<u8> {
        ensure!(self.bit_pos < self.data.len() * 8, "DST bitstream 提前结束");
        let byte = self.data[self.bit_pos / 8];
        let bit = (byte >> (7 - (self.bit_pos & 7))) & 1;
        self.bit_pos += 1;
        Ok(bit)
    }

    fn read_bits(&mut self, bits: usize) -> Result<u32> {
        ensure!(bits <= 32, "DST 单次读取 bit 数超限");
        ensure!(self.bits_left() >= bits, "DST bitstream 提前结束");
        let mut value = 0u32;
        for _ in 0..bits {
            value = (value << 1) | u32::from(self.read_bit()?);
        }
        Ok(value)
    }

    /// Arithmetic DST decoding specifies zero-fill once the coded payload is exhausted.
    /// This is deliberately separate from structural reads, which must still fail on EOF.
    fn read_bits_zero_padded(&mut self, bits: usize) -> Result<u32> {
        ensure!(bits <= 32, "DST arithmetic 单次读取 bit 数超限");
        let mut value = 0u32;
        for _ in 0..bits {
            value <<= 1;
            if self.bit_pos < self.data.len() * 8 {
                let byte = self.data[self.bit_pos / 8];
                value |= u32::from((byte >> (7 - (self.bit_pos & 7))) & 1);
            }
            self.bit_pos = self.bit_pos.saturating_add(1);
        }
        Ok(value)
    }

    fn read_signed_bits(&mut self, bits: usize) -> Result<i32> {
        ensure!(bits > 0 && bits <= 31, "DST signed coefficient 位宽无效");
        let value = self.read_bits(bits)?;
        let sign = 1u32 << (bits - 1);
        if value & sign == 0 {
            Ok(value as i32)
        } else {
            Ok((value as i32) - (1i32 << bits))
        }
    }

    /// JPEG-LS unsigned Golomb/Rice form used by DST coefficient prediction.
    fn read_ur_golomb_jpegls(&mut self, k: usize) -> Result<i32> {
        ensure!(k <= 31, "DST Golomb 参数无效");
        let limit = self.bits_left();
        ensure!(limit > 0, "DST Golomb 数据为空");
        let mut zeroes = 0usize;
        while zeroes < limit {
            if self.read_bit()? != 0 {
                break;
            }
            zeroes += 1;
        }
        if zeroes < limit.saturating_sub(1) {
            let suffix = self.read_bits(k)? as usize;
            let value = suffix
                .checked_add(zeroes.checked_shl(k as u32).context("DST Golomb 溢出")?)
                .ok_or_else(|| anyhow!("DST Golomb 溢出"))?;
            i32::try_from(value).map_err(|_| anyhow!("DST Golomb 值超限"))
        } else if zeroes == limit.saturating_sub(1) {
            Ok(1)
        } else {
            Err(anyhow!("DST Golomb code 无终止 bit"))
        }
    }

    fn read_sr_golomb_dst(&mut self, k: usize) -> Result<i32> {
        let mut value = self.read_ur_golomb_jpegls(k)?;
        if value != 0 && self.read_bit()? != 0 {
            value = -value;
        }
        Ok(value)
    }
}

trait CheckedShift {
    fn context(self, message: &'static str) -> Result<usize>;
}

impl CheckedShift for Option<usize> {
    fn context(self, message: &'static str) -> Result<usize> {
        self.ok_or_else(|| anyhow!(message))
    }
}

#[derive(Clone)]
struct Table {
    elements: usize,
    length: [usize; MAX_ELEMENTS],
    coeff: [[i32; MAX_COEFFS]; MAX_ELEMENTS],
}

impl Default for Table {
    fn default() -> Self {
        Self {
            elements: 0,
            length: [0; MAX_ELEMENTS],
            coeff: [[0; MAX_COEFFS]; MAX_ELEMENTS],
        }
    }
}

#[derive(Default)]
struct ArithCoder {
    a: u32,
    c: u32,
}

impl ArithCoder {
    fn init(&mut self, reader: &mut BitReader<'_>) -> Result<()> {
        self.a = 4095;
        self.c = reader.read_bits_zero_padded(12)?;
        Ok(())
    }

    fn get(&mut self, reader: &mut BitReader<'_>, probability: i32) -> Result<u8> {
        ensure!(
            (1..=255).contains(&probability),
            "DST arithmetic probability 无效"
        );
        let k = (self.a >> 8) | ((self.a >> 7) & 1);
        let q = k
            .checked_mul(probability as u32)
            .ok_or_else(|| anyhow!("DST arithmetic 溢出"))?;
        let a_q = self
            .a
            .checked_sub(q)
            .ok_or_else(|| anyhow!("DST arithmetic range 无效"))?;
        let residual = self.c < a_q;
        if residual {
            self.a = a_q;
        } else {
            self.a = q;
            self.c = self
                .c
                .checked_sub(a_q)
                .ok_or_else(|| anyhow!("DST arithmetic code 无效"))?;
        }
        if self.a < 2048 {
            ensure!(self.a > 0, "DST arithmetic range 归零");
            let log2 = 31 - self.a.leading_zeros();
            let shift = 11usize.saturating_sub(log2 as usize);
            self.a <<= shift;
            self.c = (self.c << shift) | reader.read_bits_zero_padded(shift)?;
        }
        Ok(u8::from(residual))
    }
}

fn read_map(
    reader: &mut BitReader<'_>,
    table: &mut Table,
    channels: usize,
) -> Result<[usize; MAX_CHANNELS]> {
    let mut map = [0usize; MAX_CHANNELS];
    table.elements = 1;
    if reader.read_bit()? == 0 {
        for slot in map.iter_mut().take(channels).skip(1) {
            let bits = (usize::BITS - table.elements.leading_zeros()) as usize;
            let value = reader.read_bits(bits)? as usize;
            ensure!(value <= table.elements, "DST element map 越界");
            *slot = value;
            if value == table.elements {
                table.elements += 1;
                ensure!(table.elements < MAX_ELEMENTS, "DST element 数量超限");
            }
        }
    }
    Ok(map)
}

fn read_uncoded_coeff(
    reader: &mut BitReader<'_>,
    destination: &mut [i32],
    elements: usize,
    coeff_bits: usize,
    signed: bool,
    offset: i32,
) -> Result<()> {
    for item in destination.iter_mut().take(elements) {
        *item = if signed {
            reader.read_signed_bits(coeff_bits)?
        } else {
            reader.read_bits(coeff_bits)? as i32
        } + offset;
    }
    Ok(())
}

fn read_table(
    reader: &mut BitReader<'_>,
    table: &mut Table,
    prediction: &[[i32; 3]; 3],
    length_bits: usize,
    coeff_bits: usize,
    signed: bool,
    offset: i32,
) -> Result<()> {
    for element in 0..table.elements {
        table.length[element] = reader.read_bits(length_bits)? as usize + 1;
        ensure!(
            table.length[element] <= MAX_COEFFS,
            "DST coefficient table 过长"
        );
        if reader.read_bit()? == 0 {
            read_uncoded_coeff(
                reader,
                &mut table.coeff[element],
                table.length[element],
                coeff_bits,
                signed,
                offset,
            )?;
            continue;
        }

        let method = reader.read_bits(2)? as usize;
        ensure!(method < 3, "DST coefficient prediction method 无效");
        read_uncoded_coeff(
            reader,
            &mut table.coeff[element],
            method + 1,
            coeff_bits,
            signed,
            offset,
        )?;
        let lsb_size = reader.read_bits(3)? as usize;
        for index in (method + 1)..table.length[element] {
            let mut predicted = 0i32;
            for k in 0..=method {
                predicted = predicted.wrapping_add(
                    prediction[method][k].wrapping_mul(table.coeff[element][index - k - 1]),
                );
            }
            let mut coefficient = reader.read_sr_golomb_dst(lsb_size)?;
            if predicted >= 0 {
                coefficient = coefficient.wrapping_sub((predicted + 4) / 8);
            } else {
                coefficient = coefficient.wrapping_add((-predicted + 3) / 8);
            }
            if !signed {
                ensure!(
                    coefficient >= offset && coefficient < offset + (1 << coeff_bits),
                    "DST probability coefficient 越界"
                );
            }
            table.coeff[element][index] = coefficient;
        }
    }
    Ok(())
}

fn build_filter(fsets: &Table) -> Result<[[[i16; 256]; FILTER_BYTES]; MAX_ELEMENTS]> {
    let mut filter = [[[0i16; 256]; FILTER_BYTES]; MAX_ELEMENTS];
    for (element, element_filter) in filter.iter_mut().enumerate().take(fsets.elements) {
        let length = fsets.length[element];
        for (byte_index, table) in element_filter.iter_mut().enumerate() {
            let start = byte_index * 8;
            let total = length.saturating_sub(start).min(8);
            for (status, result) in table.iter_mut().enumerate() {
                let mut value = 0i32;
                for bit in 0..total {
                    let sign = if (status >> bit) & 1 != 0 { 1 } else { -1 };
                    value = value.wrapping_add(sign * fsets.coeff[element][start + bit]);
                }
                *result =
                    i16::try_from(value).map_err(|_| anyhow!("DST filter coefficient 溢出"))?;
            }
        }
    }
    Ok(filter)
}

fn prob_dst_x_bit(coefficient: i32) -> i32 {
    i32::from((((coefficient & 127) as u8).reverse_bits() >> 1) + 1)
}

fn shift_status(status: &mut [u8; FILTER_BYTES], bit: u8) {
    let low = u64::from_le_bytes(status[0..8].try_into().unwrap());
    let high = u64::from_le_bytes(status[8..16].try_into().unwrap());
    status[8..16].copy_from_slice(&((high << 1) | (low >> 63)).to_le_bytes());
    status[0..8].copy_from_slice(&((low << 1) | u64::from(bit)).to_le_bytes());
}

/// Pure-Rust DST decoder. Output is planar MSB-first DSD.
pub struct DstDecoder {
    pub channel_count: usize,
    fsets: Table,
    probs: Table,
    status: [[u8; FILTER_BYTES]; MAX_CHANNELS],
}

impl DstDecoder {
    pub fn new(channel_count: usize) -> Self {
        Self {
            channel_count,
            fsets: Table::default(),
            probs: Table::default(),
            status: [[0xAA; FILTER_BYTES]; MAX_CHANNELS],
        }
    }

    pub fn decode_frame(&mut self, dst_data: &[u8], out_dsd: &mut [u8]) -> Result<usize> {
        ensure!(
            (1..=MAX_CHANNELS).contains(&self.channel_count),
            "DST 声道数不支持"
        );
        ensure!(dst_data.len() > 1, "DST frame 过短");
        let required = self.channel_count * BYTES_PER_FRAME_CHANNEL;
        ensure!(
            out_dsd.len() >= required,
            "Output DSD buffer too small for DST frame"
        );
        out_dsd[..required].fill(0);

        let mut reader = BitReader::new(dst_data);
        if reader.read_bit()? == 0 {
            let _dst_x = reader.read_bit()?;
            ensure!(
                reader.read_bits(6)? == 0,
                "DST raw frame stuffing pattern 无效"
            );
            ensure!(
                reader.bits_left() >= required * 8,
                "DST raw DSD frame 长度不足"
            );
            for byte_index in 0..BYTES_PER_FRAME_CHANNEL {
                for channel in 0..self.channel_count {
                    out_dsd[channel * BYTES_PER_FRAME_CHANNEL + byte_index] =
                        reader.read_bits(8)? as u8;
                }
            }
            return Ok(required);
        }

        // Common SACD DST segmentation form supported by FFmpeg.
        ensure!(
            reader.read_bit()? != 0,
            "DST non-same segmentation 暂不支持"
        );
        ensure!(
            reader.read_bit()? != 0,
            "DST per-channel segmentation 暂不支持"
        );
        ensure!(
            reader.read_bit()? != 0,
            "DST non-terminal channel segmentation 暂不支持"
        );

        let same_map = reader.read_bit()? != 0;
        let map_f = read_map(&mut reader, &mut self.fsets, self.channel_count)?;
        let map_p = if same_map {
            self.probs.elements = self.fsets.elements;
            map_f
        } else {
            read_map(&mut reader, &mut self.probs, self.channel_count)?
        };

        let mut half_prob = [false; MAX_CHANNELS];
        for item in half_prob.iter_mut().take(self.channel_count) {
            *item = reader.read_bit()? != 0;
        }

        read_table(
            &mut reader,
            &mut self.fsets,
            &FSETS_CODE_PRED_COEFF,
            7,
            9,
            true,
            0,
        )?;
        read_table(
            &mut reader,
            &mut self.probs,
            &PROBS_CODE_PRED_COEFF,
            6,
            7,
            false,
            1,
        )?;

        ensure!(reader.read_bit()? == 0, "DST arithmetic stuffing bit 无效");
        let mut arithmetic = ArithCoder::default();
        arithmetic.init(&mut reader)?;
        let filter = build_filter(&self.fsets)?;
        self.status.fill([0xAA; FILTER_BYTES]);

        // This first arithmetic symbol is specified by DST but does not itself become audio.
        let _ = arithmetic.get(&mut reader, prob_dst_x_bit(self.fsets.coeff[0][0]))?;

        for sample in 0..SAMPLES_PER_FRAME_CHANNEL {
            let byte_index = sample >> 3;
            let bit_shift = 7 - (sample & 7);
            for channel in 0..self.channel_count {
                let filter_element = map_f[channel];
                ensure!(filter_element < self.fsets.elements, "DST filter map 越界");
                let mut sum = 0i32;
                for slot in 0..FILTER_BYTES {
                    sum += i32::from(
                        filter[filter_element][slot][self.status[channel][slot] as usize],
                    );
                }
                let predict = sum as i16;
                let probability =
                    if !half_prob[channel] || sample >= self.fsets.length[filter_element] {
                        let probability_element = map_p[channel];
                        ensure!(
                            probability_element < self.probs.elements,
                            "DST probability map 越界"
                        );
                        let length = self.probs.length[probability_element];
                        ensure!(length > 0, "DST probability table 为空");
                        let index = ((i32::from(predict).abs() as usize) >> 3).min(length - 1);
                        self.probs.coeff[probability_element][index]
                    } else {
                        128
                    };
                let residual = arithmetic.get(&mut reader, probability)?;
                let bit = ((((predict >> 15) as i32) ^ i32::from(residual)) & 1) as u8;
                if bit != 0 {
                    out_dsd[channel * BYTES_PER_FRAME_CHANNEL + byte_index] |= 1 << bit_shift;
                }
                shift_status(&mut self.status[channel], bit);
            }
        }

        Ok(required)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_dst_frame_demuxes_to_planar_msb_dsd() {
        let mut frame = vec![0u8; 1 + BYTES_PER_FRAME_CHANNEL * 2];
        // DSTCoded=0, DstXBit=0, stuffing=0 occupies the first full byte.
        for i in 0..BYTES_PER_FRAME_CHANNEL {
            frame[1 + i * 2] = (i & 0xff) as u8;
            frame[1 + i * 2 + 1] = (!(i as u8)).wrapping_add(0);
        }
        let mut decoded = vec![0u8; BYTES_PER_FRAME_CHANNEL * 2];
        let size = DstDecoder::new(2)
            .decode_frame(&frame, &mut decoded)
            .unwrap();
        assert_eq!(size, decoded.len());
        for i in 0..BYTES_PER_FRAME_CHANNEL {
            assert_eq!(decoded[i], (i & 0xff) as u8);
            assert_eq!(decoded[BYTES_PER_FRAME_CHANNEL + i], !(i as u8));
        }
    }
}
