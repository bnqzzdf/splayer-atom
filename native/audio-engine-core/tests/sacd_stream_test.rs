use audio_engine_core::sacd::{AreaType, SacdTrackReader, SACD_SECTOR_SIZE};
use std::path::PathBuf;

const FRAME_BYTES: usize = 4704 * 2;

fn sectors(payload: &[u8], time: u32, dst: bool) -> Vec<[u8; SACD_SECTOR_SIZE]> {
    let chunks: Vec<_> = payload.chunks(1800).collect();
    chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| {
            let mut sector = [0xa5; SACD_SECTOR_SIZE];
            let first = index == 0;
            sector[0] = (1 << 5) | (u8::from(first) << 2) | u8::from(dst);
            sector[1] = (u8::from(first) << 7) | (2 << 3) | ((chunk.len() >> 8) as u8);
            sector[2] = chunk.len() as u8;
            let mut offset = 3;
            if first {
                sector[3] = (time / 4500) as u8;
                sector[4] = (time / 75 % 60) as u8;
                sector[5] = (time % 75) as u8;
                offset = 6;
                if dst {
                    sector[6] = (chunks.len() as u8) << 2;
                    offset += 1;
                }
            }
            sector[offset..offset + chunk.len()].copy_from_slice(chunk);
            sector
        })
        .collect()
}

fn fixture(
    audio: &[[u8; SACD_SECTOR_SIZE]],
    frames: u32,
    start: u32,
    dst: bool,
    stereo: bool,
    channels: u8,
) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.iso");
    let mut bytes = vec![0u8; (550 + audio.len()) * SACD_SECTOR_SIZE];
    let master = 510 * SACD_SECTOR_SIZE;
    bytes[master..master + 8].copy_from_slice(b"SACDMTOC");
    let address = if stereo { 64 } else { 72 };
    let size = if stereo { 84 } else { 86 };
    bytes[master + address..master + address + 4].copy_from_slice(&520u32.to_be_bytes());
    bytes[master + size..master + size + 2].copy_from_slice(&3u16.to_be_bytes());
    let area = 520 * SACD_SECTOR_SIZE;
    bytes[area..area + 8].copy_from_slice(if stereo { b"TWOCHTOC" } else { b"MULCHTOC" });
    bytes[area + 21] = if dst { 0 } else { 2 };
    bytes[area + 32] = channels;
    bytes[area + 69] = 1;
    let offsets = 521 * SACD_SECTOR_SIZE;
    bytes[offsets..offsets + 8].copy_from_slice(b"SACDTRL1");
    bytes[offsets + 8..offsets + 12].copy_from_slice(&550u32.to_be_bytes());
    bytes[offsets + 1028..offsets + 1032].copy_from_slice(&(audio.len() as u32).to_be_bytes());
    let times = 522 * SACD_SECTOR_SIZE;
    bytes[times..times + 8].copy_from_slice(b"SACDTRL2");
    for (offset, value) in [(times + 8, start), (times + 1028, frames)] {
        bytes[offset] = (value / 4500) as u8;
        bytes[offset + 1] = (value / 75 % 60) as u8;
        bytes[offset + 2] = (value % 75) as u8;
    }
    for (index, sector) in audio.iter().enumerate() {
        bytes[(550 + index) * SACD_SECTOR_SIZE..(551 + index) * SACD_SECTOR_SIZE]
            .copy_from_slice(sector);
    }
    std::fs::write(&path, bytes).unwrap();
    (dir, path)
}

fn pattern(seed: u8) -> Vec<u8> {
    (0..FRAME_BYTES)
        .map(|i| (i as u8).wrapping_mul(13).wrapping_add(seed))
        .collect()
}

#[test]
fn stereo_only_never_falls_back_to_multichannel() {
    let audio = sectors(&pattern(1), 0, false);
    let (_dir, path) = fixture(&audio, 1, 0, false, false, 6);
    let error = SacdTrackReader::open_track(&path, 1)
        .err()
        .unwrap()
        .to_string();
    assert!(error.contains("多声道不支持"));
    let error = SacdTrackReader::open_track_in_area(&path, 1, AreaType::MultiChannel)
        .err()
        .unwrap()
        .to_string();
    assert!(error.contains("多声道不支持"));
    let (_dir, path) = fixture(&audio, 1, 0, false, true, 6);
    assert!(SacdTrackReader::open_track(&path, 1).is_err());
}

#[test]
fn dsd_packets_preserve_msb_byte_interleaving_across_sectors_and_reads() {
    let expected = pattern(0x80);
    let audio = sectors(&expected, 19500, false);
    let (_dir, path) = fixture(&audio, 1, 19500, false, true, 2);
    let mut reader = SacdTrackReader::open_track(&path, 1).unwrap();
    let mut actual = Vec::new();
    let mut buffer = [0u8; 37];
    loop {
        let size = reader.read_interleaved_dsd(&mut buffer).unwrap();
        if size == 0 {
            break;
        }
        actual.extend_from_slice(&buffer[..size]);
    }
    assert_eq!(actual, expected);
    assert_eq!(reader.current_frame, 1);
}

#[test]
fn seek_decodes_frames_instead_of_estimating_sector_position() {
    let first = pattern(1);
    let second = pattern(7);
    let mut audio = sectors(&first, 100, false);
    audio.extend(sectors(&second, 101, false));
    let (_dir, path) = fixture(&audio, 2, 100, false, true, 2);
    let mut reader = SacdTrackReader::open_track(&path, 1).unwrap();
    reader.seek_seconds(1.0 / 75.0).unwrap();
    let mut actual = vec![0; FRAME_BYTES];
    assert_eq!(
        reader.read_interleaved_dsd(&mut actual).unwrap(),
        FRAME_BYTES
    );
    assert_eq!(actual, second);
    assert_eq!(reader.read_interleaved_dsd(&mut actual).unwrap(), 0);
    reader.seek_seconds(0.0).unwrap();
    assert_eq!(
        reader.read_interleaved_dsd(&mut actual).unwrap(),
        FRAME_BYTES
    );
    assert_eq!(actual, first);
    assert!(reader.seek_seconds(f64::NAN).is_err());
}

#[test]
fn dst_track_start_ignores_leading_continuation_until_first_frame_start() {
    let expected = pattern(0x5a);
    let mut raw_dst = Vec::with_capacity(expected.len() + 1);
    raw_dst.push(0); // DSTCoded=0, DstXBit=0, stuffing=0.
    raw_dst.extend_from_slice(&expected);

    let mut leading = [0xa5; SACD_SECTOR_SIZE];
    let continuation = [0xde, 0xad, 0xbe, 0xef];
    leading[0] = (1 << 5) | 1; // one packet, no frame info, DST sector
    leading[1] = (2 << 3) | ((continuation.len() >> 8) as u8); // audio, no frame_start
    leading[2] = continuation.len() as u8;
    leading[3..3 + continuation.len()].copy_from_slice(&continuation);

    let mut audio = vec![leading];
    audio.extend(sectors(&raw_dst, 0, true));
    let (_dir, path) = fixture(&audio, 1, 0, true, true, 2);
    let mut reader = SacdTrackReader::open_track(path, 1).unwrap();
    let mut actual = vec![0; FRAME_BYTES];
    assert_eq!(
        reader.read_interleaved_dsd(&mut actual).unwrap(),
        FRAME_BYTES
    );
    assert_eq!(actual, expected);
    assert_eq!(reader.read_interleaved_dsd(&mut actual).unwrap(), 0);
}

#[test]
fn track_start_ignores_complete_preroll_frames_before_toc_start() {
    let preroll_a = pattern(0x11);
    let preroll_b = pattern(0x22);
    let preroll_c = pattern(0x33);
    let expected_a = pattern(0x44);
    let expected_b = pattern(0x55);
    let mut audio = sectors(&preroll_a, 97, false);
    audio.extend(sectors(&preroll_b, 98, false));
    audio.extend(sectors(&preroll_c, 99, false));
    audio.extend(sectors(&expected_a, 100, false));
    audio.extend(sectors(&expected_b, 101, false));

    let (_dir, path) = fixture(&audio, 2, 100, false, true, 2);
    let mut reader = SacdTrackReader::open_track(path, 1).unwrap();
    let mut actual = vec![0; FRAME_BYTES * 2];
    assert_eq!(
        reader.read_interleaved_dsd(&mut actual).unwrap(),
        FRAME_BYTES * 2
    );
    assert_eq!(&actual[..FRAME_BYTES], expected_a.as_slice());
    assert_eq!(&actual[FRAME_BYTES..], expected_b.as_slice());
    assert_eq!(reader.current_frame, 2);
    assert_eq!(reader.read_interleaved_dsd(&mut actual).unwrap(), 0);
}

#[test]
fn dst_error_is_propagated_and_reader_cannot_resume_after_failure() {
    let audio = sectors(&[0xff], 0, true);
    let (_dir, path) = fixture(&audio, 1, 0, true, true, 2);
    let mut reader = SacdTrackReader::open_track(&path, 1).unwrap();
    let mut buffer = [0; 100];
    let error = reader.read_interleaved_dsd(&mut buffer).unwrap_err();
    assert!(format!("{error:#}").contains("DST 解码失败"));
    assert_eq!(reader.current_frame, 0);
    assert!(reader.read_interleaved_dsd(&mut buffer).is_err());
    assert!(reader.seek_seconds(0.0).is_err());
}

#[test]
fn truncated_and_malformed_frames_fail_instead_of_returning_short_success() {
    for audio in [
        sectors(&pattern(0)[..2000], 0, false),
        {
            let mut a = sectors(&pattern(0), 0, false);
            a[0][1] = 0x97;
            a[0][2] = 0xff;
            a
        },
        {
            let mut a = sectors(&pattern(0), 0, false);
            a[0][1] &= 0x7f;
            a
        },
        sectors(&pattern(0), 1, false),
    ] {
        let (_dir, path) = fixture(&audio, 1, 0, false, true, 2);
        let mut reader = SacdTrackReader::open_track(path, 1).unwrap();
        assert!(reader.read_interleaved_dsd(&mut [0; FRAME_BYTES]).is_err());
    }
}

#[test]
fn missing_final_frame_is_not_clean_eof() {
    let audio = sectors(&pattern(0), 0, false);
    let (_dir, path) = fixture(&audio, 2, 0, false, true, 2);
    let mut reader = SacdTrackReader::open_track(path, 1).unwrap();
    assert!(reader
        .read_interleaved_dsd(&mut [0; FRAME_BYTES * 2])
        .is_err());
}

#[test]
fn supplementary_packets_and_sector_padding_are_not_audio() {
    let expected = pattern(0x39);
    let mut audio = sectors(&expected, 0, false);
    let first = &mut audio[0];
    first.fill(0xa5);
    first[0] = (2 << 5) | (1 << 2);
    first[1] = 3 << 3;
    first[2] = 3;
    first[3] = 0x80 | (2 << 3) | (1800 >> 8) as u8;
    first[4] = 1800u16 as u8;
    first[5..8].fill(0);
    first[8..11].copy_from_slice(&[0xff, 0xee, 0xdd]);
    first[11..1811].copy_from_slice(&expected[..1800]);
    let (_dir, path) = fixture(&audio, 1, 0, false, true, 2);
    let mut reader = SacdTrackReader::open_track(path, 1).unwrap();
    let mut actual = vec![0; FRAME_BYTES];
    assert_eq!(
        reader.read_interleaved_dsd(&mut actual).unwrap(),
        FRAME_BYTES
    );
    assert_eq!(actual, expected);
}

#[test]
fn both_areas_still_select_only_stereo() {
    let audio = sectors(&pattern(0x12), 0, false);
    let (_dir, path) = fixture(&audio, 1, 0, false, true, 2);
    let mut bytes = std::fs::read(&path).unwrap();
    let copy = bytes[520 * SACD_SECTOR_SIZE..523 * SACD_SECTOR_SIZE].to_vec();
    bytes[530 * SACD_SECTOR_SIZE..533 * SACD_SECTOR_SIZE].copy_from_slice(&copy);
    let master = 510 * SACD_SECTOR_SIZE;
    bytes[master + 72..master + 76].copy_from_slice(&530u32.to_be_bytes());
    bytes[master + 86..master + 88].copy_from_slice(&3u16.to_be_bytes());
    bytes[530 * SACD_SECTOR_SIZE..530 * SACD_SECTOR_SIZE + 8].copy_from_slice(b"MULCHTOC");
    bytes[530 * SACD_SECTOR_SIZE + 32] = 6;
    std::fs::write(&path, bytes).unwrap();
    let reader = SacdTrackReader::open_track(&path, 1).unwrap();
    assert_eq!(reader.channels, 2);
    assert!(SacdTrackReader::open_track_in_area(&path, 1, AreaType::MultiChannel).is_err());
}

#[test]
fn dst_channel_and_packet_count_mismatch_fail_before_decode() {
    for info in [0, 1 << 2 | 2, 2 << 2] {
        let mut audio = sectors(&[0xff], 0, true);
        audio[0][6] = info;
        let (_dir, path) = fixture(&audio, 1, 0, true, true, 2);
        let mut reader = SacdTrackReader::open_track(path, 1).unwrap();
        let error = reader.read_interleaved_dsd(&mut [0; 8]).unwrap_err();
        assert!(!error.to_string().contains("解码失败"));
    }
}
