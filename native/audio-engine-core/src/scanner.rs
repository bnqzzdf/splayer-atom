//! 批量扫描目录，提取音频元数据，通过回调推送进度和结果。
//!
//! 在后台线程中运行，避免阻塞 Node.js 事件循环。
//! 支持增量扫描：比对文件 mtime/size 跳过未变化的文件。
//! 使用 FFmpeg 提取元数据，无需额外依赖 lofty。

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Instant, SystemTime};

use ffmpeg_audio::AudioReader;
use tracing::{debug, info, warn};
use walkdir::WalkDir;

use crate::metadata;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "aac", "m4a", "wma", "opus", "ape", "dsf", "dff", "dsdiff", "iso",
    "cue",
];

/// 每批回调的文件数
const BATCH_SIZE: usize = 20;
const SLOW_PROBE_THRESHOLD_MS: u128 = 50;
const MAX_PROBE_WORKERS: usize = 8;

/// 已有文件记录，用于增量扫描比对
pub struct FileRecord {
    pub path: String,
    pub mtime: u64,
    pub size: u64,
    pub cover_path: Option<String>,
}

/// 扫描到的曲目信息
pub struct ScannedTrack {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track: Option<u16>,
    pub duration: f64,
    pub codec: String,
    pub sample_rate: u32,
    pub bit_rate: i64,
    pub channels: u32,
    pub bits_per_sample: u32,
    pub cover: Option<String>,
    pub file_size: u64,
    pub mtime: u64,
    pub ctime: u64,
}

/// 扫描事件
pub enum ScanEvent {
    /// 进度：已处理一批文件
    Progress {
        scanned: u32,
        total: u32,
        current: Option<String>,
        tracks: Vec<ScannedTrack>,
    },
    /// 扫描完成
    Done {
        scanned: u32,
        total: u32,
        removed_paths: Vec<String>,
        /// 遍历时顺带收集到的 CUE 文件路径
        cue_files: Vec<String>,
        /// 不可达的扫描目录
        unavailable_dirs: Vec<String>,
    },
}

/// 判断文件是否为音频文件
fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// 判断文件是否为 CUE 分轨描述文件
fn is_cue_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cue"))
}

/// 根据本轮可见路径计算已删除文件；遍历不完整的目录必须整体排除
fn collect_removed_paths<T>(
    existing: &HashMap<&str, T>,
    scanned_paths: &[String],
    unavailable_dirs: &[String],
) -> Vec<String> {
    let scanned_set: HashSet<&str> = scanned_paths.iter().map(String::as_str).collect();
    existing
        .keys()
        .filter(|path| !scanned_set.contains(**path))
        .filter(|path| {
            !unavailable_dirs
                .iter()
                .any(|dir| Path::new(**path).starts_with(dir))
        })
        .map(|&path| path.to_string())
        .collect()
}

/// 使用 ffmpeg_audio 打开音频文件并读取元数据
///
/// 新 API 下 AudioReader 不再要求重采样参数，扫库每文件省一次 SwrContext 分配
pub fn probe_fast(path: &str, cover_cache_dir: Option<&str>) -> Option<ScannedTrack> {
    let directory_cover = metadata::find_directory_cover(Path::new(path));
    probe_fast_with_directory_cover(path, cover_cache_dir, directory_cover.as_deref())
}

fn probe_fast_with_directory_cover(
    path: &str,
    cover_cache_dir: Option<&str>,
    directory_cover: Option<&Path>,
) -> Option<ScannedTrack> {
    let directory_cover_thumbnail = || {
        cover_cache_dir.and_then(|dir| {
            directory_cover
                .and_then(|cover| metadata::extract_directory_cover_thumbnail(cover, dir))
        })
    };
    if crate::sacd::is_sacd_iso_path(path) {
        if let Ok(mut reader) = crate::sacd::IsoReader::open(path) {
            if let Ok(disc) = crate::sacd::SacdDisc::parse(&mut reader) {
                let area = disc
                    .stereo_area_idx
                    .and_then(|idx| disc.areas.get(idx))
                    .or_else(|| {
                        disc.multichannel_area_idx
                            .and_then(|idx| disc.areas.get(idx))
                    })
                    .or_else(|| disc.areas.first());
                if let Some(area) = area {
                    if let Some(t) = area.tracks.first() {
                        return Some(ScannedTrack {
                            path: path.to_string(),
                            title: disc.album_title.clone().or_else(|| t.title.clone()),
                            artist: disc.album_artist.clone().or_else(|| t.artist.clone()),
                            album: disc.album_title.clone(),
                            track: Some(1),
                            duration: area.tracks.iter().map(|tr| tr.duration).sum(),
                            codec: if t.is_dst {
                                "sacd_dst".to_string()
                            } else {
                                "sacd_dsd".to_string()
                            },
                            sample_rate: t.sample_rate,
                            bit_rate: t.bit_rate as i64,
                            channels: t.channels as u32,
                            bits_per_sample: 1,
                            cover: directory_cover_thumbnail(),
                            file_size: reader.total_sectors as u64 * 2048,
                            mtime: 0,
                            ctime: 0,
                        });
                    }
                }
            }
        }
    }

    if crate::cue::is_cue_path(path) {
        if let Ok(cue) = crate::cue::CueSheet::parse_file(path) {
            let total_dur: f64 = cue.tracks.iter().filter_map(|t| t.duration).sum();
            return Some(ScannedTrack {
                path: path.to_string(),
                title: cue.global_title.clone(),
                artist: cue.global_performer.clone(),
                album: cue.global_title.clone(),
                track: None,
                duration: total_dur,
                codec: "cue".to_string(),
                sample_rate: 44_100,
                bit_rate: 1_411_200,
                channels: 2,
                bits_per_sample: 16,
                cover: directory_cover_thumbnail(),
                file_size: 0,
                mtime: 0,
                ctime: 0,
            });
        }
    }

    if crate::dsd::is_dsd_path(path) {
        // Native DSD 的格式/时长由专用解析器负责，但标签仍从 FFmpeg 容器 metadata 读取。
        // 过去这里直接返回导致 DSF/DFF 的 artist/album 丢失，播放时才会被 probeMetadata 补回。
        let dsd_reader = fs::File::open(path)
            .ok()
            .and_then(|file| AudioReader::new(file).ok());
        let dsd_tags = dsd_reader.as_ref().map(|reader| {
            let raw_metadata = reader.metadata();
            metadata::repair_legacy_gbk_tags_for_path(metadata::extract_tags(&raw_metadata), path)
        });
        let dsd_cover = cover_cache_dir
            .and_then(|dir| {
                dsd_reader.as_ref().and_then(|reader| {
                    metadata::extract_cover_thumbnail_with_directory_cover(
                        reader,
                        path,
                        dir,
                        directory_cover,
                    )
                })
            })
            .or_else(directory_cover_thumbnail);
        if path.to_lowercase().ends_with(".dsf") {
            if let Ok(dsf) = crate::dsd::DsfReader::open(path) {
                return Some(ScannedTrack {
                    path: path.to_string(),
                    title: dsd_tags
                        .as_ref()
                        .and_then(|tags| tags.title.clone())
                        .or_else(|| {
                            Path::new(path)
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .map(String::from)
                        }),
                    artist: dsd_tags.as_ref().and_then(|tags| tags.artist.clone()),
                    album: dsd_tags.as_ref().and_then(|tags| tags.album.clone()),
                    track: dsd_tags.as_ref().and_then(|tags| tags.track),
                    duration: dsf.duration_seconds,
                    codec: "dsd_dsf".to_string(),
                    sample_rate: dsf.sample_rate,
                    bit_rate: (dsf.sample_rate as i64 * dsf.channels as i64),
                    channels: dsf.channels as u32,
                    bits_per_sample: 1,
                    cover: dsd_cover.clone(),
                    file_size: dsf.data_size,
                    mtime: 0,
                    ctime: 0,
                });
            }
        } else if path.to_lowercase().ends_with(".dff") || path.to_lowercase().ends_with(".dsdiff")
        {
            if let Ok(dff) = crate::dsd::DffReader::open(path) {
                return Some(ScannedTrack {
                    path: path.to_string(),
                    title: dsd_tags
                        .as_ref()
                        .and_then(|tags| tags.title.clone())
                        .or_else(|| {
                            Path::new(path)
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .map(String::from)
                        }),
                    artist: dsd_tags.as_ref().and_then(|tags| tags.artist.clone()),
                    album: dsd_tags.as_ref().and_then(|tags| tags.album.clone()),
                    track: dsd_tags.as_ref().and_then(|tags| tags.track),
                    duration: dff.duration_seconds,
                    codec: "dsd_dff".to_string(),
                    sample_rate: dff.sample_rate,
                    bit_rate: (dff.sample_rate as i64 * dff.channels as i64),
                    channels: dff.channels as u32,
                    bits_per_sample: 1,
                    cover: dsd_cover,
                    file_size: dff.data_size,
                    mtime: 0,
                    ctime: 0,
                });
            }
        }
    }

    let file = fs::File::open(path).ok()?;
    let reader = AudioReader::new(file).ok()?;

    let duration = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);

    let info = reader.source_info();
    let stream_info = metadata::extract_stream_info(info);
    let mut codec = info.codec_name.clone().unwrap_or_default();

    // codec 兜底：从扩展名推导
    if codec.is_empty() {
        codec = Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
    }

    let raw_metadata = reader.metadata();
    let tags =
        metadata::repair_legacy_gbk_tags_for_path(metadata::extract_tags(&raw_metadata), path);

    let cover = cover_cache_dir.and_then(|dir| {
        metadata::extract_cover_thumbnail_with_directory_cover(&reader, path, dir, directory_cover)
    });

    Some(ScannedTrack {
        path: path.to_string(),
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        track: tags.track,
        duration,
        codec,
        sample_rate: stream_info.sample_rate,
        bit_rate: stream_info.bit_rate,
        channels: stream_info.channels,
        bits_per_sample: stream_info.bits_per_sample,
        cover,
        file_size: 0, // 由调用方填充
        mtime: 0,
        ctime: 0,
    })
}

fn cached_directory_cover(
    cache: &mut HashMap<PathBuf, Option<PathBuf>>,
    source: &Path,
) -> Option<PathBuf> {
    let parent = source.parent()?.to_path_buf();
    cache
        .entry(parent)
        .or_insert_with(|| metadata::find_directory_cover(source))
        .clone()
}

struct ProbeResult {
    path: String,
    mtime: u64,
    ctime: u64,
    size: u64,
    directory_cover: Option<PathBuf>,
    track: Option<ScannedTrack>,
    elapsed_ms: u128,
}

/// 并行执行独立文件的元数据探测，结果仍按收集顺序交给上层，保持进度和数据库写入稳定。
fn probe_audio_files_parallel(
    files: &[(String, u64, u64, u64, Option<PathBuf>)],
    cover_cache_dir: Option<&str>,
    cancel: &AtomicBool,
    on_result: &mut impl FnMut(ProbeResult),
) {
    if files.is_empty() {
        return;
    }

    let worker_count = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(1)
        .min(MAX_PROBE_WORKERS)
        .min(files.len());
    let next_index = AtomicUsize::new(0);
    let (sender, receiver) = mpsc::channel();

    thread::scope(|scope| {
        for _ in 0..worker_count {
            let sender = sender.clone();
            let next_index = &next_index;
            let cancel = &cancel;
            scope.spawn(move || loop {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let index = next_index.fetch_add(1, Ordering::Relaxed);
                let Some((path, mtime, ctime, size, directory_cover)) = files.get(index) else {
                    break;
                };
                let started = Instant::now();
                let track = probe_fast_with_directory_cover(
                    path,
                    cover_cache_dir,
                    directory_cover.as_deref(),
                );
                if sender
                    .send((
                        index,
                        ProbeResult {
                            path: path.clone(),
                            mtime: *mtime,
                            ctime: *ctime,
                            size: *size,
                            directory_cover: directory_cover.clone(),
                            track,
                            elapsed_ms: started.elapsed().as_millis(),
                        },
                    ))
                    .is_err()
                {
                    break;
                }
            });
        }
        drop(sender);

        // 正常扫描保持文件收集顺序；只保留尚未形成连续前缀的少量结果，避免整库驻留内存。
        let mut pending = BTreeMap::new();
        let mut next_index = 0;
        for (index, result) in receiver {
            pending.insert(index, result);
            while let Some(result) = pending.remove(&next_index) {
                on_result(result);
                next_index += 1;
            }
        }
        // 取消时某个较早索引可能仍未完成；释放已完成但未形成连续前缀的结果。
        for (_, result) in pending {
            on_result(result);
        }
    });
}

/// 获取文件时间与大小：
/// - mtime: 修改时间（Unix ms）
/// - ctime: 创建时间（Unix ms，若不可用回退为 mtime）
pub fn file_stat(path: &Path) -> Option<(u64, u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    let ctime = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(mtime);
    Some((mtime, ctime, meta.len()))
}

/// 批量扫描目录
///
/// - `dirs`: 待扫描目录列表
/// - `cover_cache_dir`: 封面缓存目录
/// - `incremental_data`: 可选的已有文件记录，用于增量跳过
/// - `cancel`: 取消标志，外部设置为 true 后扫描会尽快停止
/// - `callback`: 回调函数，接收 ScanEvent
pub fn scan_directories(
    dirs: &[String],
    cover_cache_dir: Option<&str>,
    incremental_data: Option<&[FileRecord]>,
    cancel: &AtomicBool,
    callback: &dyn Fn(ScanEvent),
) {
    let scan_start = Instant::now();
    info!("开始扫描，目录数: {}", dirs.len());

    // 构建已有文件索引 path → (mtime, size, cover cache path)
    let existing: HashMap<&str, (u64, u64, Option<&str>)> = incremental_data
        .map(|records| {
            records
                .iter()
                .map(|r| (r.path.as_str(), (r.mtime, r.size, r.cover_path.as_deref())))
                .collect()
        })
        .unwrap_or_default();

    // 第一遍：收集所有音频文件路径
    let walk_start = Instant::now();
    let mut audio_files: Vec<(String, u64, u64, u64, Option<PathBuf>)> = Vec::new();
    let mut scanned_paths: Vec<String> = Vec::new();
    let mut cue_files: Vec<String> = Vec::new();
    // 扫描结束即释放；避免同一目录的每首曲目都重复枚举封面文件。
    let mut directory_cover_cache: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
    // 本轮不可达的目录（NAS 掉线 / 移动硬盘未挂载），其下已有记录不得报告为已删除
    let mut unavailable_dirs: Vec<String> = Vec::new();

    for dir in dirs {
        if cancel.load(Ordering::Relaxed) {
            info!("扫描已取消（文件收集阶段）");
            return;
        }
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() {
            warn!("跳过无效目录: {dir}");
            unavailable_dirs.push(dir.clone());
            continue;
        }
        let mut had_traversal_error = false;
        for entry in WalkDir::new(dir).follow_links(true) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    had_traversal_error = true;
                    warn!(directory = dir, error = %error, "目录遍历不完整，本轮不计算该目录下的删除项");
                    continue;
                }
            };
            let path = entry.path();
            if !entry.file_type().is_file() {
                continue;
            }
            if is_cue_file(path) {
                cue_files.push(path.to_string_lossy().into_owned());
                continue;
            }
            if !is_audio_file(path) {
                continue;
            }
            let path_str = path.to_string_lossy().into_owned();
            let Some((mtime, ctime, size)) = file_stat(path) else {
                had_traversal_error = true;
                warn!(path = %path.display(), "无法读取文件状态，本轮不计算所属目录下的删除项");
                continue;
            };
            scanned_paths.push(path_str.clone());
            let directory_cover = cover_cache_dir
                .and_then(|_| cached_directory_cover(&mut directory_cover_cache, path));
            // 增量比对：mtime 和 size 都未变化则跳过
            if let Some(&(old_mtime, old_size, cover_path)) = existing.get(path_str.as_str()) {
                let cover_is_current = cover_cache_dir.is_none_or(|cache_dir| {
                    !metadata::cover_cache_needs_refresh(
                        cover_path,
                        cache_dir,
                        directory_cover.as_deref(),
                    )
                });
                if old_mtime == mtime && old_size == size && cover_is_current {
                    continue;
                }
            }
            audio_files.push((path_str, mtime, ctime, size, directory_cover));
        }
        if had_traversal_error {
            unavailable_dirs.push(dir.clone());
        }
    }

    let total = audio_files.len() as u32;
    let walk_elapsed = walk_start.elapsed();
    info!(
        "目录遍历完成: 发现 {} 个音频文件，其中 {} 个需要处理，耗时 {:.2?}",
        scanned_paths.len(),
        total,
        walk_elapsed,
    );

    // 第二遍：并行提取元数据，分批回调
    let parse_start = Instant::now();
    let mut scanned: u32 = 0;
    let mut batch: Vec<ScannedTrack> = Vec::with_capacity(BATCH_SIZE);
    let mut slow_probes = 0_u32;
    let mut cover_cache_misses = 0_u32;
    let mut cancelled = false;
    probe_audio_files_parallel(&audio_files, cover_cache_dir, cancel, &mut |result| {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            return;
        }
        let current_name = Path::new(&result.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());

        let has_cover_cache_miss = result.directory_cover.is_some()
            && result
                .track
                .as_ref()
                .is_some_and(|track| track.cover.is_none());
        if result.elapsed_ms >= SLOW_PROBE_THRESHOLD_MS {
            slow_probes += 1;
            warn!(
                path = %result.path,
                elapsed_ms = result.elapsed_ms,
                cover_cache_miss = has_cover_cache_miss,
                "曲库元数据探测较慢"
            );
        }
        if has_cover_cache_miss {
            cover_cache_misses += 1;
            debug!(path = %result.path, "曲库封面缓存未命中");
        }

        match result.track {
            Some(mut track) => {
                track.file_size = result.size;
                track.mtime = result.mtime;
                track.ctime = result.ctime;
                batch.push(track);
            }
            None => {
                debug!("跳过文件 {}: FFmpeg 无法解析", result.path);
            }
        }

        scanned += 1;

        // 达到批次大小或最后一个文件，推送进度
        if batch.len() >= BATCH_SIZE || scanned == total {
            callback(ScanEvent::Progress {
                scanned,
                total,
                current: current_name,
                tracks: std::mem::replace(&mut batch, Vec::with_capacity(BATCH_SIZE)),
            });
        }
    });

    if cancelled || cancel.load(Ordering::Relaxed) {
        info!("扫描已取消（元数据提取阶段，已处理 {scanned}/{total}）");
        callback(ScanEvent::Done {
            scanned,
            total,
            removed_paths: Vec::new(),
            cue_files: std::mem::take(&mut cue_files),
            unavailable_dirs,
        });
        return;
    }

    // 计算已删除的文件（在 existing 中但不在 scanned_paths 中）
    // 不可达目录下的记录排除在外：目录只是暂时离线，报告删除会导致一次扫描清空曲库
    let removed_paths = collect_removed_paths(&existing, &scanned_paths, &unavailable_dirs);

    if !removed_paths.is_empty() {
        info!("发现 {} 个已删除文件", removed_paths.len());
    }

    let parse_elapsed = parse_start.elapsed();
    let total_elapsed = scan_start.elapsed();
    let throughput = if parse_elapsed.as_secs_f64() > 0.0 {
        scanned as f64 / parse_elapsed.as_secs_f64()
    } else {
        0.0
    };
    info!(
        "扫描完成: 处理 {}/{} 个文件，目录遍历 {:.2?}，元数据解析 {:.2?}，总计 {:.2?}（{:.0} 文件/秒，慢探测 {}，封面缓存未命中 {}）",
        scanned,
        scanned_paths.len(),
        walk_elapsed,
        parse_elapsed,
        total_elapsed,
        throughput,
        slow_probes,
        cover_cache_misses,
    );

    callback(ScanEvent::Done {
        scanned,
        total,
        removed_paths,
        cue_files,
        unavailable_dirs,
    });
}

/// 解析单个 CUE 文件并展开为完整分轨列表
pub fn probe_cue_tracks(cue_path: &str, _cover_cache_dir: Option<&str>) -> Vec<ScannedTrack> {
    let (mtime, ctime, file_size) = file_stat(Path::new(cue_path)).unwrap_or((0, 0, 0));
    let Ok(cue) = crate::cue::CueSheet::parse_file(cue_path) else {
        return Vec::new();
    };

    let mut tracks = Vec::new();
    for t in cue.tracks {
        let (sample_rate, channels, bit_rate, bits_per_sample, codec) = {
            if let Some(meta) = probe_fast(&t.physical_path.to_string_lossy(), None) {
                (
                    meta.sample_rate,
                    meta.channels,
                    meta.bit_rate,
                    meta.bits_per_sample,
                    meta.codec,
                )
            } else {
                (44_100, 2, 1_411_200, 16, "flac".to_string())
            }
        };

        let duration = t.duration.unwrap_or(0.0);
        tracks.push(ScannedTrack {
            path: t.virtual_path,
            title: t.title,
            artist: t.artist.or_else(|| cue.global_performer.clone()),
            album: t.album.or_else(|| cue.global_title.clone()),
            track: Some(t.track_num),
            duration,
            codec,
            sample_rate,
            bit_rate,
            channels,
            bits_per_sample,
            cover: None,
            file_size,
            mtime,
            ctime,
        });
    }
    tracks
}

/// 解析单个 SACD ISO 镜像文件并展开为全部音轨列表
pub fn probe_sacd_tracks(iso_path: &str) -> Vec<ScannedTrack> {
    let (mtime, ctime, file_size) = file_stat(Path::new(iso_path)).unwrap_or((0, 0, 0));
    let Ok(mut reader) = crate::sacd::IsoReader::open(iso_path) else {
        return Vec::new();
    };
    let Ok(disc) = crate::sacd::SacdDisc::parse(&mut reader) else {
        return Vec::new();
    };

    let area = if let Some(idx) = disc.stereo_area_idx {
        disc.areas.get(idx)
    } else if let Some(idx) = disc.multichannel_area_idx {
        disc.areas.get(idx)
    } else {
        disc.areas.first()
    };

    let Some(area) = area else {
        return Vec::new();
    };

    let mut tracks = Vec::new();
    for t in &area.tracks {
        tracks.push(ScannedTrack {
            path: t.virtual_path.clone(),
            title: t.title.clone(),
            artist: t.artist.clone().or_else(|| disc.album_artist.clone()),
            album: t.album.clone().or_else(|| disc.album_title.clone()),
            track: Some(t.track_num),
            duration: t.duration,
            codec: if t.is_dst {
                "sacd_dst".to_string()
            } else {
                "sacd_dsd".to_string()
            },
            sample_rate: t.sample_rate,
            bit_rate: t.bit_rate as i64,
            channels: t.channels as u32,
            bits_per_sample: 1,
            cover: None,
            file_size,
            mtime,
            ctime,
        });
    }
    tracks
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::io::Write;

    fn id3v23_frame(id: &[u8; 4], value: &str) -> Vec<u8> {
        let mut payload = vec![0];
        payload.extend_from_slice(value.as_bytes());
        let mut frame = Vec::with_capacity(10 + payload.len());
        frame.extend_from_slice(id);
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&[0, 0]);
        frame.extend_from_slice(&payload);
        frame
    }

    fn id3v23_picture_frame() -> Vec<u8> {
        let mut picture = vec![
            0, b'i', b'm', b'a', b'g', b'e', b'/', b'p', b'n', b'g', 0, 3, 0,
        ];
        let mut image = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut image, image::ImageFormat::Png)
            .unwrap();
        picture.extend_from_slice(image.get_ref());

        let mut frame = Vec::with_capacity(10 + picture.len());
        frame.extend_from_slice(b"APIC");
        frame.extend_from_slice(&(picture.len() as u32).to_be_bytes());
        frame.extend_from_slice(&[0, 0]);
        frame.extend_from_slice(&picture);
        frame
    }

    fn synchsafe(value: usize) -> [u8; 4] {
        [
            ((value >> 21) & 0x7f) as u8,
            ((value >> 14) & 0x7f) as u8,
            ((value >> 7) & 0x7f) as u8,
            (value & 0x7f) as u8,
        ]
    }

    fn write_tagged_dsf(path: &Path) {
        let frames = [
            id3v23_frame(b"TIT2", "DSD Track"),
            id3v23_frame(b"TPE1", "DSD Artist"),
            id3v23_frame(b"TALB", "DSD Album"),
            id3v23_frame(b"TRCK", "2"),
            id3v23_picture_frame(),
        ]
        .concat();
        let mut id3 = Vec::with_capacity(10 + frames.len());
        id3.extend_from_slice(b"ID3");
        id3.extend_from_slice(&[3, 0, 0]);
        id3.extend_from_slice(&synchsafe(frames.len()));
        id3.extend_from_slice(&frames);

        let payload_size = 8192u64;
        let metadata_offset = 28 + 52 + 12 + payload_size;
        let file_size = metadata_offset + id3.len() as u64;
        let mut file = fs::File::create(path).unwrap();
        file.write_all(b"DSD ").unwrap();
        file.write_all(&28u64.to_le_bytes()).unwrap();
        file.write_all(&file_size.to_le_bytes()).unwrap();
        file.write_all(&metadata_offset.to_le_bytes()).unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&52u64.to_le_bytes()).unwrap();
        file.write_all(&1u32.to_le_bytes()).unwrap();
        file.write_all(&0u32.to_le_bytes()).unwrap();
        file.write_all(&2u32.to_le_bytes()).unwrap();
        file.write_all(&2u32.to_le_bytes()).unwrap();
        file.write_all(&2_822_400u32.to_le_bytes()).unwrap();
        file.write_all(&1u32.to_le_bytes()).unwrap();
        file.write_all(&(2_822_400u64 * 2).to_le_bytes()).unwrap();
        file.write_all(&4096u32.to_le_bytes()).unwrap();
        file.write_all(&0u32.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&(payload_size + 12).to_le_bytes()).unwrap();
        file.write_all(&vec![0x69; payload_size as usize]).unwrap();
        file.write_all(&id3).unwrap();
    }

    #[test]
    fn native_dsd_extensions_are_part_of_the_local_library_surface() {
        assert!(is_audio_file(Path::new("album/track.dsf")));
        assert!(is_audio_file(Path::new("album/track.DFF")));
        assert!(is_audio_file(Path::new("album/track.dsdiff")));
    }

    #[test]
    fn dsf_scan_preserves_container_tags_while_using_native_dsd_format() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("tagged.dsf");
        write_tagged_dsf(&path);

        let track = probe_fast(path.to_str().unwrap(), None).unwrap();
        assert_eq!(track.title.as_deref(), Some("DSD Track"));
        assert_eq!(track.artist.as_deref(), Some("DSD Artist"));
        assert_eq!(track.album.as_deref(), Some("DSD Album"));
        assert_eq!(track.track, Some(2));
        assert_eq!(track.codec, "dsd_dsf");
        assert_eq!(track.sample_rate, 2_822_400);
        assert_eq!(track.bits_per_sample, 1);
    }

    #[test]
    fn dsf_scan_extracts_embedded_cover_after_native_probe() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("tagged.dsf");
        let cache = temp.path().join("cache");
        write_tagged_dsf(&path);

        let track = probe_fast(path.to_str().unwrap(), cache.to_str()).unwrap();
        let cover = track.cover.expect("DSF embedded cover should be cached");
        assert!(Path::new(&cover).exists());
    }

    #[test]
    fn traversal_error_suppresses_removals_for_the_whole_root() {
        let root = Path::new("music");
        let visible = root.join("visible.mp3").to_string_lossy().into_owned();
        let hidden = root.join("restricted").join("hidden.flac");
        let outside = Path::new("other").join("removed.ogg");
        let hidden = hidden.to_string_lossy().into_owned();
        let outside = outside.to_string_lossy().into_owned();
        let existing = HashMap::from([
            (visible.as_str(), (1, 1, None::<&str>)),
            (hidden.as_str(), (1, 1, None::<&str>)),
            (outside.as_str(), (1, 1, None::<&str>)),
        ]);

        let removed = collect_removed_paths(
            &existing,
            std::slice::from_ref(&visible),
            &[root.to_string_lossy().into_owned()],
        );

        assert_eq!(removed, vec![outside]);
    }

    #[test]
    fn complete_scan_reports_missing_paths() {
        let present = Path::new("music")
            .join("present.mp3")
            .to_string_lossy()
            .into_owned();
        let missing = Path::new("music")
            .join("missing.mp3")
            .to_string_lossy()
            .into_owned();
        let existing = HashMap::from([
            (present.as_str(), (1, 1, None::<&str>)),
            (missing.as_str(), (1, 1, None::<&str>)),
        ]);

        let removed = collect_removed_paths(&existing, std::slice::from_ref(&present), &[]);

        assert_eq!(removed, vec![missing]);
    }
}
