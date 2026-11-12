import { getAllTracks, upsertTracks, type UpsertTrack } from "@main/database";
import { createLocalAlbumId } from "@main/utils/localAlbum";
import { libraryLog } from "@main/utils/logger";
import { parseAlbum, parseArtists } from "@main/utils/metadata";
import type { Track } from "@shared/types/player";
import { getEngine } from "./engine";
import { publishLibraryRevision } from "./libraryRevision";

const REPLACEMENT = "\uFFFD";

const hasReplacement = (track: Track): boolean =>
  track.title.includes(REPLACEMENT) ||
  track.artists.some((artist) => artist.name.includes(REPLACEMENT)) ||
  Boolean(track.album?.name.includes(REPLACEMENT));

const isCorruptedWav = (track: Track): boolean =>
  Boolean(track.path) &&
  !track.cuePath &&
  track.path!.toLowerCase().endsWith(".wav") &&
  hasReplacement(track);

/**
 * 旧扫描器把 WAV RIFF INFO 的 GBK 字节按 UTF-8 lossy 解码，部分文件已有正确的
 * ID3v2 标签却被 INFO 覆盖。这里只修已有库中的受损 WAV：用 lofty 读 ID3v2，
 * 缺失字段再由新的 WAV INFO 解码路径补齐；修复后下一次扫描不会重复命中。
 */
export const repairCorruptedWavTags = async (): Promise<void> => {
  const corrupted = getAllTracks().filter(isCorruptedWav);
  if (corrupted.length === 0) return;

  const upserts: UpsertTrack[] = [];
  for (const track of corrupted) {
    try {
      const tags = await getEngine().readTrackTags(track.path!);
      if (!tags.title && !tags.artist && !tags.album) continue;

      const albumName = tags.album?.trim() || track.album?.name;
      const album = albumName
        ? tags.album?.trim()
          ? parseAlbum(tags.album.trim())
          : track.album
            ? { ...track.album }
            : parseAlbum(albumName)
        : undefined;
      if (album) {
        album.id = createLocalAlbumId(album.name, track.path!);
        const albumArtist = tags.albumArtist?.trim();
        if (albumArtist) album.artist = albumArtist;
        if (tags.year) album.year = tags.year;
      }

      upserts.push({
        id: track.id,
        path: track.path!,
        title: tags.title?.trim() || track.title,
        track: tags.trackNumber ?? track.track,
        disc: tags.discNumber ?? track.disc,
        artists: parseArtists(
          tags.artist?.trim() || track.artists.map((artist) => artist.name).join("/"),
        ),
        album,
        duration: track.duration,
        cover: track.cover,
        codec: track.quality?.codec,
        sampleRate: track.quality?.sampleRate,
        bitRate: track.quality?.bitRate,
        channels: track.quality?.channels,
        bitsPerSample: track.quality?.bitsPerSample,
        fileSize: track.fileSize ?? 0,
        mtime: track.mtime ?? 0,
        ctime: track.ctime ?? 0,
      });
    } catch (error) {
      libraryLog.warn(`WAV 标签修复失败: ${track.path}`, error);
    }
  }

  if (upserts.length === 0) return;
  upsertTracks(upserts);
  publishLibraryRevision();
  libraryLog.info(`WAV 标签编码修复: ${upserts.length} 首`);
};
