#![cfg(feature = "napi")]

//! 集成测试：扫描器核心 API
//!
//! 这些测试验证 NAPI wrapper 跨 crate 使用扫描器时的公共接口。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use audio_engine_core::scanner::{FileRecord, ScanEvent, ScannedTrack};

/// 收集 scan_directories 回调事件的辅助结构
#[derive(Default)]
struct EventSink(Arc<Mutex<Vec<ScanEvent>>>);

impl EventSink {
    fn take_events(&self) -> Vec<ScanEvent> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

/// 创建一个唯一的空目录（测试结束后清理）
fn unique_temp_dir(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("audio-engine-core-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("failed to create temp dir");
    dir
}

fn write_test_wav(path: &std::path::Path) {
    let sample_rate = 44_100u32;
    let channels = 1u16;
    let bits_per_sample = 16u16;
    let samples = 256u32;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * u32::from(block_align);
    let data_size = samples * u32::from(block_align);
    let riff_size = 36 + data_size;
    let mut bytes = Vec::with_capacity((44 + data_size) as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&riff_size.to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block_align.to_le_bytes());
    bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(44 + data_size as usize, 0);
    fs::write(path, bytes).expect("failed to write test wav");
}

#[test]
fn scan_empty_directory_produces_done_event() {
    let dir = unique_temp_dir("empty");
    let sink = EventSink::default();
    let callback = |event: ScanEvent| sink.0.lock().unwrap().push(event);
    let cancel = AtomicBool::new(false);

    audio_engine_core::scanner::scan_directories(
        &[dir.to_string_lossy().into_owned()],
        None,
        None,
        true,
        &cancel,
        &callback,
    );

    let _ = fs::remove_dir_all(&dir);

    let events = sink.take_events();
    assert_eq!(events.len(), 1);
    match &events[0] {
        ScanEvent::Done {
            scanned,
            total,
            removed_paths,
            cue_files,
            unavailable_dirs,
        } => {
            assert_eq!(*scanned, 0);
            assert_eq!(*total, 0);
            assert!(removed_paths.is_empty());
            assert!(cue_files.is_empty());
            assert!(unavailable_dirs.is_empty());
        }
        ScanEvent::Progress { .. } => panic!("unexpected Progress event"),
    }
}

#[test]
fn scan_nonexistent_directory_reports_unavailable() {
    let sink = EventSink::default();
    let callback = |event: ScanEvent| sink.0.lock().unwrap().push(event);
    let cancel = AtomicBool::new(false);

    audio_engine_core::scanner::scan_directories(
        &["/no/such/audio-engine-core-directory".to_string()],
        None,
        None,
        true,
        &cancel,
        &callback,
    );

    let events = sink.take_events();
    assert_eq!(events.len(), 1);
    match &events[0] {
        ScanEvent::Done {
            scanned,
            total,
            unavailable_dirs,
            ..
        } => {
            assert_eq!(*scanned, 0);
            assert_eq!(*total, 0);
            assert_eq!(unavailable_dirs.len(), 1);
            assert!(unavailable_dirs[0].contains("no/such/audio-engine-core-directory"));
        }
        ScanEvent::Progress { .. } => panic!("unexpected Progress event"),
    }
}

#[cfg(unix)]
#[test]
fn scan_skips_symlink_targets_outside_configured_root() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("symlink-root");
    let outside = unique_temp_dir("symlink-outside");
    write_test_wav(&outside.join("outside.wav"));
    symlink(&outside, root.join("external")).expect("failed to create symlink");

    let sink = EventSink::default();
    let callback = |event: ScanEvent| sink.0.lock().unwrap().push(event);
    let cancel = AtomicBool::new(false);

    audio_engine_core::scanner::scan_directories(
        &[root.to_string_lossy().into_owned()],
        None,
        None,
        true,
        &cancel,
        &callback,
    );

    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&outside);

    let events = sink.take_events();
    let done = events
        .iter()
        .find_map(|event| match event {
            ScanEvent::Done { scanned, total, .. } => Some((*scanned, *total)),
            _ => None,
        })
        .expect("missing done event");
    assert_eq!(done, (0, 0));
}

#[cfg(unix)]
#[test]
fn scan_allows_configured_root_itself_to_be_a_symlink() {
    use std::os::unix::fs::symlink;

    let real_root = unique_temp_dir("symlink-configured-real");
    let alias_parent = unique_temp_dir("symlink-configured-alias");
    let alias = alias_parent.join("music");
    write_test_wav(&real_root.join("inside.wav"));
    symlink(&real_root, &alias).expect("failed to create configured root symlink");

    let sink = EventSink::default();
    let callback = |event: ScanEvent| sink.0.lock().unwrap().push(event);
    let cancel = AtomicBool::new(false);

    audio_engine_core::scanner::scan_directories(
        &[alias.to_string_lossy().into_owned()],
        None,
        None,
        true,
        &cancel,
        &callback,
    );

    let _ = fs::remove_dir_all(&alias_parent);
    let _ = fs::remove_dir_all(&real_root);

    let events = sink.take_events();
    let done = events
        .iter()
        .find_map(|event| match event {
            ScanEvent::Done { scanned, total, .. } => Some((*scanned, *total)),
            _ => None,
        })
        .expect("missing done event");
    assert_eq!(done, (1, 1));
}

#[cfg(unix)]
#[test]
fn broken_internal_symlink_does_not_trigger_removal() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("broken-symlink-root");
    let target = root.join("target");
    fs::create_dir_all(&target).expect("failed to create symlink target");
    let link = root.join("linked");
    symlink(&target, &link).expect("failed to create symlink");
    let previous_path = link.join("track.wav");
    fs::remove_dir_all(&target).expect("failed to remove symlink target");

    let records = vec![FileRecord {
        path: previous_path.to_string_lossy().into_owned(),
        mtime: 1,
        size: 1,
        cover_path: None,
        force_probe: false,
    }];
    let sink = EventSink::default();
    let callback = |event: ScanEvent| sink.0.lock().unwrap().push(event);
    let cancel = AtomicBool::new(false);

    audio_engine_core::scanner::scan_directories(
        &[root.to_string_lossy().into_owned()],
        None,
        Some(&records),
        true,
        &cancel,
        &callback,
    );

    let _ = fs::remove_dir_all(&root);
    let events = sink.take_events();
    let done = events
        .iter()
        .find_map(|event| match event {
            ScanEvent::Done {
                removed_paths,
                unavailable_dirs,
                ..
            } => Some((removed_paths, unavailable_dirs)),
            _ => None,
        })
        .expect("missing done event");
    assert!(done.0.is_empty());
    assert_eq!(done.1.len(), 1);
}

#[test]
fn scan_cancelled_during_walk_phase_stops_early() {
    let dir = unique_temp_dir("cancelled");
    let sink = EventSink::default();
    let callback = |event: ScanEvent| sink.0.lock().unwrap().push(event);
    let cancel = AtomicBool::new(true);

    audio_engine_core::scanner::scan_directories(
        &[dir.to_string_lossy().into_owned()],
        None,
        None,
        true,
        &cancel,
        &callback,
    );

    let _ = fs::remove_dir_all(&dir);

    // 取消发生在文件收集阶段，直接返回且不发任何事件
    assert!(sink.take_events().is_empty());
}

#[test]
fn file_record_round_trips_path_mtime_size() {
    let record = FileRecord {
        path: "tests/fixtures/track.mp3".to_string(),
        mtime: 1_000_000,
        size: 2_048,
        cover_path: None,
        force_probe: false,
    };

    assert_eq!(record.path, "tests/fixtures/track.mp3");
    assert_eq!(record.mtime, 1_000_000);
    assert_eq!(record.size, 2_048);
    assert_eq!(record.cover_path, None);
}

#[test]
fn force_rescan_processes_unchanged_existing_file() {
    let dir = unique_temp_dir("force-rescan");
    let wav = dir.join("track.wav");
    write_test_wav(&wav);
    let (mtime, _ctime, size) = audio_engine_core::scanner::file_stat(&wav).expect("test wav stat");
    let records = vec![FileRecord {
        path: wav.to_string_lossy().into_owned(),
        mtime,
        size,
        cover_path: None,
        force_probe: false,
    }];
    let cancel = AtomicBool::new(false);

    let incremental_sink = EventSink::default();
    let incremental_callback = |event: ScanEvent| incremental_sink.0.lock().unwrap().push(event);
    audio_engine_core::scanner::scan_directories(
        &[dir.to_string_lossy().into_owned()],
        None,
        Some(&records),
        true,
        &cancel,
        &incremental_callback,
    );
    let incremental = incremental_sink.take_events();
    assert_eq!(incremental.len(), 1);
    match &incremental[0] {
        ScanEvent::Done { scanned, total, .. } => {
            assert_eq!(*scanned, 0);
            assert_eq!(*total, 0);
        }
        ScanEvent::Progress { .. } => panic!("unchanged incremental file should be skipped"),
    }

    let force_sink = EventSink::default();
    let force_callback = |event: ScanEvent| force_sink.0.lock().unwrap().push(event);
    audio_engine_core::scanner::scan_directories(
        &[dir.to_string_lossy().into_owned()],
        None,
        Some(&records),
        false,
        &cancel,
        &force_callback,
    );
    let force_events = force_sink.take_events();
    assert!(
        force_events.iter().any(|event| matches!(
            event,
            ScanEvent::Progress {
                scanned: 1,
                total: 1,
                ..
            }
        )),
        "force rescan must probe an unchanged existing file",
    );
    assert!(force_events.iter().any(|event| matches!(
        event,
        ScanEvent::Done {
            scanned: 1,
            total: 1,
            ..
        }
    )));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn scanned_track_holds_all_expected_fields() {
    let track = ScannedTrack {
        path: "tests/fixtures/track.mp3".to_string(),
        title: Some("Title".to_string()),
        artist: Some("Artist".to_string()),
        album_artist: Some("Album Artist".to_string()),
        album: Some("Album".to_string()),
        year: Some(2001),
        track: Some(1),
        disc: Some(2),
        duration: 180.5,
        codec: "mp3".to_string(),
        sample_rate: 44_100,
        bit_rate: 128_000,
        channels: 2,
        bits_per_sample: 16,
        cover: Some("tests/cache/cover.jpg".to_string()),
        file_size: 4_096,
        mtime: 1_000_000,
        ctime: 500_000,
    };

    assert_eq!(track.title, Some("Title".to_string()));
    assert_eq!(track.artist, Some("Artist".to_string()));
    assert_eq!(track.album_artist, Some("Album Artist".to_string()));
    assert_eq!(track.album, Some("Album".to_string()));
    assert_eq!(track.year, Some(2001));
    assert_eq!(track.track, Some(1));
    assert_eq!(track.disc, Some(2));
    assert!((track.duration - 180.5).abs() < f64::EPSILON);
    assert_eq!(track.codec, "mp3");
    assert_eq!(track.sample_rate, 44_100);
    assert_eq!(track.bit_rate, 128_000);
    assert_eq!(track.channels, 2);
    assert_eq!(track.bits_per_sample, 16);
    assert_eq!(track.cover, Some("tests/cache/cover.jpg".to_string()));
    assert_eq!(track.file_size, 4_096);
    assert_eq!(track.mtime, 1_000_000);
    assert_eq!(track.ctime, 500_000);
}
