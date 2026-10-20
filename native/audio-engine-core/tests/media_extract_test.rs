use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use audio_engine_core::dsd::reverse_byte;
use audio_engine_core::media_extract::{extract_cue_track_to_dsf, extract_cue_track_to_wav};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "splayer-atom-media-extract-{}-{nonce}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_pcm_wav(path: &Path, sample_rate: u32, bits: u16, frames: usize) -> Vec<u8> {
    let bytes_per_sample = usize::from(bits / 8);
    let block_align = 2 * bytes_per_sample;
    let mut data = Vec::with_capacity(frames * block_align);
    for frame in 0..frames {
        let value = ((frame as i32 * 7919) & 0x7f_ffff) - 0x40_0000;
        let left = value;
        let right = -value;
        match bits {
            16 => {
                data.extend_from_slice(&(left as i16).to_le_bytes());
                data.extend_from_slice(&(right as i16).to_le_bytes());
            }
            24 => {
                data.extend_from_slice(&left.to_le_bytes()[..3]);
                data.extend_from_slice(&right.to_le_bytes()[..3]);
            }
            _ => panic!("unsupported fixture bit depth"),
        }
    }
    let data_len = u32::try_from(data.len()).unwrap();
    let mut wav = Vec::with_capacity(44 + data.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * u32::try_from(block_align).unwrap()).to_le_bytes());
    wav.extend_from_slice(&u16::try_from(block_align).unwrap().to_le_bytes());
    wav.extend_from_slice(&bits.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&data);
    fs::write(path, wav).unwrap();
    data
}

fn write_two_track_cue(path: &Path, audio_name: &str, second_index: &str) {
    fs::write(
        path,
        format!(
            "FILE \"{audio_name}\" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 01 {second_index}\n"
        ),
    )
    .unwrap();
}

#[test]
fn cue_wav_extract_preserves_exact_16bit_sample_range() {
    let temp = TempDir::new();
    let source = temp.path.join("master.wav");
    let cue = temp.path.join("album.cue");
    let output = temp.path.join("track01.wav");
    let source_pcm = write_pcm_wav(&source, 44_100, 16, 88_200);
    write_two_track_cue(&cue, "master.wav", "00:01:00");

    let result = extract_cue_track_to_wav(&cue, 1, &output).unwrap();
    assert_eq!(result.sample_rate, 44_100);
    assert_eq!(result.channels, 2);
    assert_eq!(result.valid_bits, 16);
    assert_eq!(result.storage_bits, 16);
    assert_eq!(result.samples_per_channel, 44_100);
    assert_eq!(result.duration_ms, 1000);

    let output_bytes = fs::read(output).unwrap();
    let output_pcm = &output_bytes[44..];
    assert_eq!(output_pcm, &source_pcm[..44_100 * 4]);
}

#[test]
fn cue_wav_extract_seeks_to_second_track_correctly() {
    let temp = TempDir::new();
    let source = temp.path.join("master.wav");
    let cue = temp.path.join("album.cue");
    let output = temp.path.join("track02.wav");
    let source_pcm = write_pcm_wav(&source, 44_100, 16, 88_200);
    write_two_track_cue(&cue, "master.wav", "00:01:00");

    let result = extract_cue_track_to_wav(&cue, 2, &output).unwrap();
    assert_eq!(result.sample_rate, 44_100);
    assert_eq!(result.channels, 2);
    assert_eq!(result.valid_bits, 16);
    assert_eq!(result.storage_bits, 16);
    assert_eq!(result.samples_per_channel, 44_100);
    assert_eq!(result.duration_ms, 1000);

    let output_bytes = fs::read(output).unwrap();
    let output_pcm = &output_bytes[44..];
    assert_eq!(output_pcm, &source_pcm[44_100 * 4..]);
}

#[test]
fn cue_wav_extract_repackages_24bit_without_changing_sample_bits() {
    let temp = TempDir::new();
    let source = temp.path.join("master24.wav");
    let cue = temp.path.join("album24.cue");
    let output = temp.path.join("track01.wav");
    let source_pcm = write_pcm_wav(&source, 44_100, 24, 1176);
    write_two_track_cue(&cue, "master24.wav", "00:00:01");

    let result = extract_cue_track_to_wav(&cue, 1, &output).unwrap();
    assert_eq!(result.valid_bits, 24);
    assert_eq!(result.storage_bits, 24);
    assert_eq!(result.samples_per_channel, 588);

    let output_bytes = fs::read(output).unwrap();
    let output_pcm = &output_bytes[44..];
    assert_eq!(output_pcm, &source_pcm[..588 * 6]);
}

fn write_dsf(path: &Path, logical_left: &[u8], logical_right: &[u8], sample_rate: u32) {
    assert_eq!(logical_left.len(), logical_right.len());
    let block_size = 4096usize;
    let blocks = logical_left.len().div_ceil(block_size);
    let mut payload = Vec::with_capacity(blocks * block_size * 2);
    for block in 0..blocks {
        let start = block * block_size;
        let end = (start + block_size).min(logical_left.len());
        for channel in [logical_left, logical_right] {
            for byte in &channel[start..end] {
                payload.push(reverse_byte(*byte));
            }
            payload.extend(std::iter::repeat_n(
                reverse_byte(0x69),
                block_size - (end - start),
            ));
        }
    }

    let total_size = 28 + 52 + 12 + payload.len();
    let mut file = Vec::with_capacity(total_size);
    file.extend_from_slice(b"DSD ");
    file.extend_from_slice(&28_u64.to_le_bytes());
    file.extend_from_slice(&(total_size as u64).to_le_bytes());
    file.extend_from_slice(&0_u64.to_le_bytes());
    file.extend_from_slice(b"fmt ");
    file.extend_from_slice(&52_u64.to_le_bytes());
    file.extend_from_slice(&1_u32.to_le_bytes());
    file.extend_from_slice(&0_u32.to_le_bytes());
    file.extend_from_slice(&2_u32.to_le_bytes());
    file.extend_from_slice(&2_u32.to_le_bytes());
    file.extend_from_slice(&sample_rate.to_le_bytes());
    file.extend_from_slice(&1_u32.to_le_bytes());
    file.extend_from_slice(&((logical_left.len() as u64) * 8).to_le_bytes());
    file.extend_from_slice(&(block_size as u32).to_le_bytes());
    file.extend_from_slice(&0_u32.to_le_bytes());
    file.extend_from_slice(b"data");
    file.extend_from_slice(&((12 + payload.len()) as u64).to_le_bytes());
    file.extend_from_slice(&payload);
    fs::write(path, file).unwrap();
}

fn read_dsf_logical_channels(path: &Path) -> (u64, Vec<u8>, Vec<u8>) {
    let bytes = fs::read(path).unwrap();
    assert_eq!(&bytes[..4], b"DSD ");
    assert_eq!(&bytes[28..32], b"fmt ");
    assert_eq!(&bytes[80..84], b"data");
    let sample_count = u64::from_le_bytes(bytes[64..72].try_into().unwrap());
    assert_eq!(sample_count % 8, 0);
    let valid_bytes = usize::try_from(sample_count / 8).unwrap();
    let block_size =
        usize::try_from(u32::from_le_bytes(bytes[72..76].try_into().unwrap())).unwrap();
    let payload = &bytes[92..];
    let mut left = Vec::with_capacity(valid_bytes);
    let mut right = Vec::with_capacity(valid_bytes);
    for group in payload.chunks_exact(block_size * 2) {
        let remaining = valid_bytes.saturating_sub(left.len());
        if remaining == 0 {
            break;
        }
        let take = remaining.min(block_size);
        left.extend(group[..take].iter().map(|byte| reverse_byte(*byte)));
        right.extend(
            group[block_size..block_size + take]
                .iter()
                .map(|byte| reverse_byte(*byte)),
        );
    }
    assert_eq!(left.len(), valid_bytes);
    assert_eq!(right.len(), valid_bytes);
    (sample_count, left, right)
}

fn append_dff_chunk(target: &mut Vec<u8>, id: &[u8; 4], payload: &[u8]) {
    target.extend_from_slice(id);
    target.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    target.extend_from_slice(payload);
    if !payload.len().is_multiple_of(2) {
        target.push(0);
    }
}

fn write_dff(path: &Path, payload: &[u8], sample_rate: u32) {
    let mut prop = Vec::new();
    prop.extend_from_slice(b"SND ");
    append_dff_chunk(&mut prop, b"FS  ", &sample_rate.to_be_bytes());
    let mut channels = Vec::new();
    channels.extend_from_slice(&2_u16.to_be_bytes());
    channels.extend_from_slice(b"SLFTSRGT");
    append_dff_chunk(&mut prop, b"CHNL", &channels);
    append_dff_chunk(&mut prop, b"CMPR", b"DSD ");
    let mut body = Vec::new();
    append_dff_chunk(&mut body, b"PROP", &prop);
    append_dff_chunk(&mut body, b"DSD ", payload);
    let mut file = Vec::new();
    file.extend_from_slice(b"FRM8");
    file.extend_from_slice(&(4_u64 + body.len() as u64).to_be_bytes());
    file.extend_from_slice(b"DSD ");
    file.extend_from_slice(&body);
    fs::write(path, file).unwrap();
}

fn dsd_fixture_channels(bytes_per_channel: usize) -> (Vec<u8>, Vec<u8>) {
    let left = (0..bytes_per_channel)
        .map(|index| ((index * 17 + 3) & 0xff) as u8)
        .collect();
    let right = (0..bytes_per_channel)
        .map(|index| ((index * 29 + 11) & 0xff) as u8)
        .collect();
    (left, right)
}

#[test]
fn dsd_cue_generated_dsf_preserves_dsf_source_logical_sequence() {
    const RATE: u32 = 2_822_400;
    const BYTES_PER_CUE_FRAME: usize = 4_704;
    let temp = TempDir::new();
    let source = temp.path.join("master.dsf");
    let cue = temp.path.join("album.cue");
    let output = temp.path.join("track02.dsf");
    let (left, right) = dsd_fixture_channels(BYTES_PER_CUE_FRAME * 2);
    write_dsf(&source, &left, &right, RATE);
    write_two_track_cue(&cue, "master.dsf", "00:00:01");

    let result = extract_cue_track_to_dsf(&cue, 2, &output).unwrap();
    assert_eq!(result.sample_rate, RATE);
    assert_eq!(result.channels, 2);
    assert_eq!(result.bits_per_channel, (BYTES_PER_CUE_FRAME * 8) as u64);
    let (sample_count, actual_left, actual_right) = read_dsf_logical_channels(&output);
    assert_eq!(sample_count, result.bits_per_channel);
    assert_eq!(actual_left, left[BYTES_PER_CUE_FRAME..]);
    assert_eq!(actual_right, right[BYTES_PER_CUE_FRAME..]);
}

#[test]
fn dsd_cue_generated_dsf_preserves_dff_source_logical_sequence() {
    const RATE: u32 = 2_822_400;
    const BYTES_PER_CUE_FRAME: usize = 4_704;
    let temp = TempDir::new();
    let source = temp.path.join("master.dff");
    let cue = temp.path.join("album.cue");
    let output = temp.path.join("track01.dsf");
    let (left, right) = dsd_fixture_channels(BYTES_PER_CUE_FRAME * 2);
    let mut master = Vec::with_capacity(BYTES_PER_CUE_FRAME * 4);
    for index in 0..left.len() {
        master.push(left[index]);
        master.push(right[index]);
    }
    write_dff(&source, &master, RATE);
    write_two_track_cue(&cue, "master.dff", "00:00:01");

    let result = extract_cue_track_to_dsf(&cue, 1, &output).unwrap();
    let (sample_count, actual_left, actual_right) = read_dsf_logical_channels(&output);
    assert_eq!(sample_count, result.bits_per_channel);
    assert_eq!(actual_left, left[..BYTES_PER_CUE_FRAME]);
    assert_eq!(actual_right, right[..BYTES_PER_CUE_FRAME]);
}
