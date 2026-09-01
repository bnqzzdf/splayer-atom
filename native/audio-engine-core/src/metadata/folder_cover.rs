//! 从音频文件所在目录查找外部封面图片。
//!
//! 当音频文件没有内嵌封面时，回退到同目录下的常见封面文件。
//! 支持的文件名（不区分大小写）按优先级排列：
//! cover → folder → album → front → 封面 → 封套 → <同名> → 专用封面子目录 → 目录下唯一图片

use std::path::{Path, PathBuf};

/// 按优先级排列的封面文件名列表（不含扩展名）
const COVER_NAMES: &[&str] = &["cover", "folder", "album", "front", "封面", "封套"];

/// 常见的专用封面子目录名
const COVER_SUBDIRS: &[&str] = &["artwork", "scans", "covers", "pictures", "封面"];

/// 支持的图片扩展名
const COVER_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp"];

/// 在音频文件所在目录查找封面图片。
///
/// 查找顺序：
/// 1. 固定优先名：cover / folder / album / front / 封面 / 封套
/// 2. 与音频文件同名的图片文件
/// 3. 专用封面子目录中的固定优先名或唯一图片
/// 4. 目录下唯一的图片文件
///
/// @param audio_path - 音频文件路径
/// @returns 找到的封面图片路径，未找到返回 None
pub fn find_folder_cover(audio_path: &str) -> Option<PathBuf> {
    let audio = Path::new(audio_path);
    let dir = audio.parent()?;

    let entries = list_dir_images(dir)?;

    // 按优先名匹配
    for name in COVER_NAMES {
        for ext in COVER_EXTS {
            let target = format!("{name}.{ext}");
            if let Some(path) = find_case_insensitive(&entries, &target) {
                return Some(path);
            }
        }
    }

    // 与音频同名的图片
    let stem = audio.file_stem()?.to_str()?;
    for ext in COVER_EXTS {
        let target = format!("{stem}.{ext}");
        if let Some(path) = find_case_insensitive(&entries, &target) {
            return Some(path);
        }
    }

    for subdir in list_cover_subdirs(dir) {
        let Some(subdir_entries) = list_dir_images(&subdir) else {
            continue;
        };
        if let Some(path) = find_named_cover(&subdir_entries) {
            return Some(path);
        }
        if subdir_entries.len() == 1 {
            return subdir_entries.into_iter().next();
        }
    }

    // 专用封面目录应优先于根目录里唯一但无语义的随机图片
    if entries.len() == 1 {
        return entries.into_iter().next();
    }

    None
}

fn find_named_cover(entries: &[PathBuf]) -> Option<PathBuf> {
    for name in COVER_NAMES {
        for ext in COVER_EXTS {
            if let Some(path) = find_case_insensitive(entries, &format!("{name}.{ext}")) {
                return Some(path);
            }
        }
    }
    None
}

fn list_cover_subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut subdirs = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        COVER_SUBDIRS
                            .iter()
                            .any(|expected| name.eq_ignore_ascii_case(expected))
                    })
        })
        .collect::<Vec<_>>();
    subdirs.sort_by_cached_key(|path| path.to_string_lossy().to_ascii_lowercase());
    subdirs
}

/// 列出目录下所有支持扩展名的图片文件
fn list_dir_images(dir: &Path) -> Option<Vec<PathBuf>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut images = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // 无扩展名的文件直接跳过，不影响其他文件的扫描
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if COVER_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
            images.push(path);
        }
    }
    Some(images)
}

/// 大小写不敏感匹配文件名
fn find_case_insensitive(entries: &[PathBuf], target: &str) -> Option<PathBuf> {
    let target_lower = target.to_ascii_lowercase();
    entries
        .iter()
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.to_ascii_lowercase() == target_lower)
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir()
            .join("splayer-folder-cover-tests")
            .join(format!("{}-{}", std::process::id(), unique_counter()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn unique_counter() -> u64 {
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    fn touch(dir: &Path, name: &str) {
        fs::write(dir.join(name), b"fake image").unwrap();
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn finds_cover_jpg() {
        let dir = temp_dir();
        touch(&dir, "cover.jpg");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(
            result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
            Some("cover.jpg".to_string())
        );
        cleanup(&dir);
    }

    #[test]
    fn priority_cover_over_folder() {
        let dir = temp_dir();
        touch(&dir, "cover.png");
        touch(&dir, "folder.jpg");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(
            result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
            Some("cover.png".to_string())
        );
        cleanup(&dir);
    }

    #[test]
    fn same_name_as_audio() {
        let dir = temp_dir();
        touch(&dir, "track01.jpg");
        touch(&dir, "other.txt");
        touch(&dir, "track01.flac");

        let result = find_folder_cover(dir.join("track01.flac").to_str().unwrap());
        assert_eq!(
            result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
            Some("track01.jpg".to_string())
        );
        cleanup(&dir);
    }

    #[test]
    fn single_image_in_dir() {
        let dir = temp_dir();
        touch(&dir, "random_name.jpg");
        touch(&dir, "track.flac");

        let result = find_folder_cover(dir.join("track.flac").to_str().unwrap());
        assert!(result.is_some());
        cleanup(&dir);
    }

    #[test]
    fn multiple_random_images_returns_none() {
        let dir = temp_dir();
        touch(&dir, "a.jpg");
        touch(&dir, "b.png");
        touch(&dir, "track.flac");

        let result = find_folder_cover(dir.join("track.flac").to_str().unwrap());
        assert!(result.is_none());
        cleanup(&dir);
    }

    #[test]
    fn no_images_returns_none() {
        let dir = temp_dir();
        touch(&dir, "track.flac");

        let result = find_folder_cover(dir.join("track.flac").to_str().unwrap());
        assert!(result.is_none());
        cleanup(&dir);
    }

    #[test]
    fn case_insensitive_match() {
        let dir = temp_dir();
        touch(&dir, "Cover.JPG");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(
            result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
            Some("Cover.JPG".to_string())
        );
        cleanup(&dir);
    }

    #[test]
    fn files_without_extension_do_not_break_scan() {
        let dir = temp_dir();
        touch(&dir, "cover.jpg");
        touch(&dir, "README");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(
            result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
            Some("cover.jpg".to_string())
        );
        cleanup(&dir);
    }

    #[test]
    fn finds_chinese_named_cover() {
        let dir = temp_dir();
        touch(&dir, "封面.jpg");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(result, Some(dir.join("封面.jpg")));
        cleanup(&dir);
    }

    #[test]
    fn finds_unique_image_in_case_insensitive_artwork_subdir() {
        let dir = temp_dir();
        let artwork = dir.join("ARTWORK");
        fs::create_dir(&artwork).unwrap();
        touch(&artwork, "booklet-front.jpg");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(result, Some(artwork.join("booklet-front.jpg")));
        cleanup(&dir);
    }

    #[test]
    fn ambiguous_artwork_subdir_does_not_choose_an_arbitrary_image() {
        let dir = temp_dir();
        let artwork = dir.join("Artwork");
        fs::create_dir(&artwork).unwrap();
        touch(&artwork, "page-01.jpg");
        touch(&artwork, "page-02.jpg");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert!(result.is_none());
        cleanup(&dir);
    }

    #[test]
    fn dedicated_cover_subdir_beats_unrelated_single_root_image() {
        let dir = temp_dir();
        let artwork = dir.join("Artwork");
        fs::create_dir(&artwork).unwrap();
        touch(&artwork, "cover.jpg");
        touch(&dir, "disc-label.jpg");
        touch(&dir, "song.flac");

        let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
        assert_eq!(result, Some(artwork.join("cover.jpg")));
        cleanup(&dir);
    }
}
