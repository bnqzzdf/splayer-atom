/**
 * QM 新歌首发
 *
 * module: newsong.NewSongServer / get_new_song_info
 *
 * 官方「新歌首发」按地区/语种分栏（`lanlist` 就是那份地区表），默认取 `type: 5`
 * （最新），与官方首屏一致。实测匿名可拉，一次 40+ 首。
 *
 * 与榜单不同，这个 musicu 接口的 `songlist[]` **自带 `file.media_mid`**——正是
 * 取流（song_url）需要的文件名基底。榜单那边 musicu 只给 songId、没有 mid，才不得不
 * 改走 Web 榜单通道（见 leaderboard.ts 的说明）；新歌这里没有这个问题。
 *
 * params:
 * - type    地区/语种：1 内地 / 2 欧美 / 3 日本 / 4 韩国 / 5 最新（默认） / 6 港台
 * - limit   返回条数，默认 50
 */

import { formatSingerName } from "../core/config";
import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

interface NewSongFile {
  media_mid?: string;
  size_128mp3?: number;
  size_320mp3?: number;
  size_ape?: number;
  size_flac?: number;
  size_192ogg?: number;
  size_new?: number[];
  hires_sample?: number;
  hires_bitdepth?: number;
}

interface RawNewSong {
  id?: number;
  mid?: string;
  name?: string;
  title?: string;
  interval?: number;
  singer?: Array<{ mid?: string; name?: string }>;
  album?: { mid?: string; name?: string };
  file?: NewSongFile;
  pay?: { pay_month?: number; pay_play?: number; price_album?: number };
}

const newSong: QMModule = async (params) => {
  const type = Number(params.type ?? 5) || 5;
  const limit = Number(params.limit ?? 50) || 50;

  const data = await qmRequest<{ songlist?: RawNewSong[] }>(
    "newsong.NewSongServer",
    "get_new_song_info",
    { type },
  );

  const songs = (data.songlist ?? [])
    .filter((song) => Boolean(song?.mid))
    .slice(0, limit)
    .map((song) => ({
      id: String(song.id ?? ""),
      mid: song.mid ?? "",
      mediaMid: song.file?.media_mid ?? "",
      name: song.name ?? song.title ?? "",
      artist: formatSingerName(song.singer),
      artists: song.singer ?? [],
      album: song.album?.name ?? "",
      albumMid: song.album?.mid ?? "",
      duration: (song.interval ?? 0) * 1000,
      pay: {
        payalbum: song.pay?.pay_month === 0 && (song.pay.price_album ?? 0) > 0 ? 1 : 0,
        payplay: song.pay?.pay_play ?? 0,
      },
      size128: song.file?.size_128mp3 ?? 0,
      size320: song.file?.size_320mp3 ?? 0,
      sizeApe: song.file?.size_ape ?? 0,
      sizeFlac: song.file?.size_flac ?? 0,
      sizeOgg: song.file?.size_192ogg ?? 0,
      sizeHiRes: song.file?.size_new?.[0] ?? 0,
      hiResSampleRate: song.file?.hires_sample ?? 0,
      hiResBitDepth: song.file?.hires_bitdepth ?? 0,
    }));

  return { code: 200, type, total: songs.length, songs };
};

export default newSong;
