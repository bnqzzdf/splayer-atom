# SPlayer Atom API Reference

> Last updated: 2026-10-26
>
> Code baseline: `dev` branch commit `5693b3fc`, product version `1.1.3`
>
> Audience: Web Control developers, automation authors, third-party integrators

## 1. Overview

SPlayer Atom Core serves the following on one port:

- **HTTP API**: `http://<core-host>:14558/api/...`
- **WebSocket**: `ws://<core-host>:14558/ws`
- **Web Control static site**: `http://<core-host>:14558/`
- **Cached images**: `http://<core-host>:14558/cache/...`

There are about **179 HTTP routes**, grouped as:

| Group | Prefix | Purpose |
| --- | --- | --- |
| Headless Control | `/api` | Playback session, player, settings, cache, downloads, plugins, streaming, providers, lyrics, stats, ListenBrainz |
| Folder Browser | `/api/library/folders` | Core host filesystem browsing and batch actions |
| Compat API | `/api/library`, `/api/playlists`, `/api/output` | Library, playlists, output scan compatibility |

HTTP and WebSocket share the port and process. In production Core serves Web Control; in development Vite serves Web and the frontend talks to Core on another port.

### 1.1 Protocol version

- Core Protocol: `1` (`GET /api/info.protocol.version`).
- Control accepts: `1..1`.
- On mismatch, clients should stop reconnecting and prompt for an upgrade instead of guessing API capabilities.

### 1.2 Conventions

- `*` means required, `?` means optional.
- `Snapshot` means `PlaybackSessionSnapshot`.
- Times are milliseconds by default; volume is `0..1`; speed is a multiplier; auto-close duration is minutes.
- Code references use repository-relative paths.

## 2. Entry point, security, and limits

### 2.1 Authentication

**Core has no authentication.** There is no `Authorization`, API key, Cookie session, or CSRF token.

`requestGuard` does two things:

1. **Host validation**: allows any IP, `localhost`, dotless hostnames, `.local`/`.lan`/`.home.arpa`/`.internal`/`.localdomain`, and exact hostnames in `ATOM_ALLOWED_HOSTS`; other public domains get `403 untrusted host`.
2. **Origin validation**: no `Origin` is allowed; `Origin: null` is rejected; a normal Origin must match `Host` exactly (in development with `ATOM_WEB_DEV_URL`, same-hostname any-port is allowed); otherwise `403 cross-origin request rejected`.

This is not authentication. Any non-browser client that can reach the port can control playback, change settings, install plugins, and write cookies. Deploy behind a network boundary (LAN/VLAN/firewall) or an authenticated reverse proxy.

### 2.2 Binding and port

- Listen address: `0.0.0.0`.
- Default port: `14558`, overridable with `ATOM_SERVER_PORT`.
- HTTP and WS share the port.

### 2.3 CORS

- Production: no CORS headers; same-origin only.
- Development: with `ATOM_WEB_DEV_URL`, `/api/*` returns `Access-Control-Allow-Origin: *` without credentials.
- `/ws`, `/cache/*`, and static assets are not covered by the CORS middleware but still pass the Host/Origin guard.

### 2.4 Request bodies and content types

- No global `bodyLimit`, no 413 handling.
- `c.req.json()` does not validate `Content-Type`; `text/plain` is parsed as JSON.
- Most endpoints use `c.req.json().catch(() => null)`, so bad JSON falls into field validation (usually 400); a few endpoints that call `await c.req.json()` directly (e.g. create playlist) return Hono's default 500 text on bad JSON.
- Per-endpoint limits:
  - image proxy: 5 MiB, 10s, no redirects;
  - streaming cover: 5 MiB, 15s;
  - plugin install script: 9,000,000 bytes, 15s, HTTPS or loopback HTTP only;
  - folder text preview: 1 MiB;
  - folder raw material stream: no total limit; supports Range;
  - `/api/player/read-lyric`: no file size limit.

### 2.5 Compression and cache headers

- No compression middleware.
- Static files have no `Cache-Control` and no ETag, only `Last-Modified`.
- `/` and `/debug` return `Cache-Control: no-store`.
- Image proxy `public, max-age=86400`; streaming cover/folder thumbnails `private, max-age=300`.

## 3. Error model

Core has no unified error envelope. Clients must handle each endpoint:

| Shape | Source | Example |
| --- | --- | --- |
| `{ "error": string }` | Headless command/validation | `400 {"error":"volume (number, 0..1) required"}` |
| `{ "success": false, "error": string }` | Compat API | `400 {"success":false,"error":"dir_required"}` |
| `{ "ok": false, "error": string }` | providers/comments/plugins | `200 {"ok":false,"error":"..."}` |
| Plain text | Host/Origin guard, Hono 404/500 | `403 untrusted host` |
| Empty body | Some image/stream endpoints | `/api/streaming/cover` missing params 400 empty body; no cover 204 |

### 3.1 HTTP status conventions

| Status | Meaning |
| --- | --- |
| `200` | Success; may also be business failure (providers/comments/plugins/streaming test/connect, download duplicate, cache dir not empty) |
| `204` | No content (streaming cover has no image) |
| `400` | Field validation failure, service-layer ordinary error, folder business/file error |
| `403` | Host/Origin guard, folder outside root |
| `404` | No route, folder missing, thumbnail has no cover |
| `409` | Sample processing unavailable, scan already running, folder cursor stale |
| `416` | Invalid Range |
| `500` | Uncaught exception (Hono default text) or endpoint JSON |
| `502` | Image proxy fetch failure |

### 3.2 Business error codes

`ErrorCode` is mainly used for playback load errors, WS `error` events, playback failure events, and download failures. See section 13.

## 4. Version and capability negotiation

### 4.1 `GET /api/info`

Returns `CoreInfo`:

```json
{
  "name": "SPlayer Atom Core",
  "version": "1.1.3",
  "commit": "5693b3fc...",
  "sourceDirty": false,
  "platform": "linux",
  "arch": "x64",
  "node": "24.18.0",
  "nodeRange": ">=22.19.0",
  "nodeReference": "24.18.0",
  "direttaSdkRelease": 150,
  "protocol": { "version": 1 },
  "capabilities": {
    "library": true,
    "playback": true,
    "download": true,
    "diretta": true,
    "netease": true,
    "qqmusic": true,
    "kugou": true,
    "qobuz": true,
    "tidal": true,
    "remoteOutput": false
  }
}
```

Field sources:

- `version`: `ATOM_APP_VERSION` → `runtime.json.atomVersion` → default `1.0.0`.
- `commit`: `ATOM_COMMIT` → `runtime.json.atomCommit` → `unknown`.
- `sourceDirty`: `ATOM_SOURCE_DIRTY==="1"`, otherwise `runtime.json.sourceDirty`.
- `direttaSdkRelease`: non-null only when the native build includes Diretta.
- `protocol.version`: constant `1`.

### 4.2 Capability bits

| Bit | Actual value | Meaning |
| --- | --- | --- |
| `library` | always `true` | Local library |
| `playback` | always `true` | Playback path |
| `download` | always `true` | Download domain |
| `diretta` | determined by native build | Whether Diretta SDK is compiled |
| `netease`/`qqmusic`/`kugou`/`qobuz`/`tidal` | always `true` | Static support, not login state |
| `remoteOutput` | **always `false`** | Even though UPnP is implemented |

Important:

- The server **does not reject any route based on capabilities**. With `remoteOutput:false`, `/api/output/devices` still returns UPnP devices.
- Capabilities are UI hints only; login state comes from `/api/providers/sessions`.

## 5. Common data structures

### 5.1 Track

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Provider ID; local is the first 16 hex chars of the path SHA-256 |
| `extId` / `mediaId` | string? | Provider secondary/media ID |
| `source` | `"local" \| "streaming" \| "netease" \| "qqmusic" \| "kugou" \| "qobuz" \| "tidal"` | Source |
| `path` / `cuePath` / `cueAudioPath` | string? | Local path, CUE, CUE audio |
| `cueStartMs` / `cueEndMs` | number? | CUE range in ms |
| `cueStartFrame75` / `cueEndFrame75` | number? | CUE 75fps integer frames |
| `serverId` / `originalId` | string? | `streaming` only |
| `title` | string | Title |
| `comment` | string? | Comment/subtitle |
| `artists` | `Artist[]` | `{id?,name,avatar?,albumCount?}` |
| `album` | `Album?` | `{id?,name,cover?,artist?,trackCount?,year?}` |
| `track` / `disc` | number? | Track/disc number |
| `duration` | number | **Milliseconds** |
| `cover` / `coverOriginal` | string? | `cache://`, `streaming-cover://`, or remote URL |
| `fileSize` | number? | Bytes |
| `mtime` / `ctime` | number? | Unix ms |
| `quality` | `AudioQuality?` | `{sampleRate Hz, channels, bitsPerSample, bitRate bps, codec}` |
| `fee` | `0 \| 1 \| 4 \| 8`? | NetEase fee flag |
| `cloud` | boolean? | Cloud track |

`LoadOptions` / `LoadResult` (legacy `/api/player/load` only):

```ts
LoadOptions = { autoPlay?: boolean; meta?: Track; context?: PlaybackContext }
LoadResult  = { detail: TrackDetail; mediaInfo: MediaInfo }
TrackDetail = {
  quality: AudioQuality;
  embeddedLyric?: string;
  externalLyrics: { format: LyricFormat; path: string }[];
}
MediaInfo = {
  title?: string; artists?: Artist[]; album?: Album;
  duration: number; cover?: string; quality?: AudioQuality;
}
```

### 5.2 Queue and session

`PlaybackQueueItem`:

```ts
{ track: Track, context?: PlaybackContext }
```

`PlaybackContext`:

```ts
{
  provider?: TrackSource;
  originId: string;
  originType: "track" | "playlist" | "album" | "artist" | "radio" | "rank" | "page";
  originName?: string;
}
```

`PlaybackSessionSnapshot`:

```ts
{
  active: boolean;
  mode: "queue" | "personalFm";
  personalFmOptions?: PersonalFmOptions;
  queue: PlaybackQueueItem[];
  originalQueue: PlaybackQueueItem[] | null;
  index: number;                 // -1 for an empty queue
  current: Track | null;
  repeat: "off" | "list" | "one";
  shuffle: "off" | "on";
  autoClose?: {
    enabled: boolean;
    duration: number;            // minutes
    endTime: number;             // epoch ms
    waitSongEnd: boolean;
    pendingStopOnEnd: boolean;
  };
}
```

`autoClose` is optional in the type; the current implementation always returns it.

### 5.3 PlayerStatus

```ts
{
  state: "idle" | "loading" | "playing" | "paused" | "stopped";
  position: number;   // ms, projected to the CUE display range
  duration: number;   // ms
  volume: number;     // 0..1, effective value
  speed: number;      // multiplier
  isFinished: boolean;
  output: {
    deviceId: string | null;
    path: "exact-pcm" | "native-dsd" | "decoded-pcm" | "processed-pcm" | null;
    sampleProcessingAvailable: boolean;
  };
}
```

### 5.4 AudioDevice

```ts
{ id: string; name: string; interfaceName?: string; isDefault: boolean }
```

Device IDs:

- ALSA: `alsa:hw:CARD=<id>,DEV=<n>`
- Diretta: `diretta:<selector>` (observed form: `diretta:fe80::...,19644`)
- UPnP: `upnp:<udn>`, e.g. `upnp:uuid:...`

### 5.5 Downloads

`DownloadRequest`:

```ts
{
  destination: "core";
  taskId: string;
  track: Track;
  qualityLevel: "hi-res" | "lossless" | "hq" | "sq" | "lq";
  url?: string;
  declaredFormat?: string;
  declaredSize?: number;
  coverUrl?: string;
  lyricText?: string;
  ttmlText?: string;
  tagOptions: {
    embedCover: boolean; embedMeta: boolean; embedLyric: boolean;
    writeLrc: boolean; saveTtml: boolean;
  };
  usePlaybackForDownload: boolean;
  lyricFileFormat: "lrc" | "enhanced-lrc";
}
```

`DownloadTask`:

```ts
{
  taskId: string;
  status: "queued" | "downloading" | "done" | "failed" | "canceled" | "interrupted";
  track: Track;
  qualityLevel: string;
  received: number;  // bytes
  total: number;     // bytes
  filePath?: string;
  errorCode?: string;
  tagWarning?: boolean;
  createdAt: number; // epoch ms
  finishedAt?: number;
}
```

`EnqueueResult`: `{ ok: boolean, reason?: "queued" | "downloaded" }`.

### 5.6 Plugins

`PluginInfo`:

```ts
{
  manifest: {
    id: string; name: string; version: string; description?: string;
    author?: string; homepage?: string;
    grant: ("network" | "control" | "ui")[];
    type?: "source" | "control";
    apiLevel: number; hash: string; updateUrl?: string; changelog?: string;
    installedAt: number; updatedAt?: number; fileName: string;
  };
  enabled: boolean;
  status:
    | { state: "unloaded" }
    | { state: "loading" }
    | { state: "ready"; sources?: unknown; events?: unknown; controls?: unknown; settings?: unknown; menus?: unknown }
    | { state: "error"; error: { code: string; message: string } }
    | { state: "disabled" };
  updateInfo?: { version?: string; log?: string; updateUrl?: string; updatedAt: number } | null;
  settingsValues?: Record<string, unknown>;
}
```

### 5.7 Streaming

`StreamingServerConfig`:

```ts
{
  id: string;
  name: string;
  type: "subsonic" | "navidrome" | "opensubsonic" | "airsonic" | "gonic" | "lms" | "jellyfin" | "emby";
  url: string;
  username: string;
  hasPassword: boolean;
  lastConnected?: number; // ms
}
```

`StreamingConfigSnapshot`:

```ts
{
  servers: StreamingServerConfig[];
  activeServerId: string | null;
  connectionStatus: {
    connected: boolean;
    error?: string;
    errorCode?: "auth" | "network" | "protocol" | "unknown";
  };
}
```

### 5.8 Stats

`PlayStatsSummary`:

```ts
{
  todayListenedMs: number; weekListenedMs: number; lastWeekListenedMs: number;
  totalListenedMs: number; weekPlayCount: number; totalPlayCount: number;
  weekFavoriteAdds: number; streakDays: number;
}
```

`LibraryStats`: `{ trackCount, albumCount, artistCount, totalDurationMs, totalFileSize, codecs: {codec,count}[] }`.

`TopTrack`: `{ track: Track, playCount: number }`; `TopAlbum` is the same shape; `TopArtist`: `{ artist, track, playCount }`.

### 5.9 Cache and settings

`CacheStat`: `{ id: CacheCategory, kind: "file" | "db", path: string, size: number }`.

`CoreSettingsSnapshot` top level:

```ts
{
  player, library, lyric, localLyric, cache, download, streaming, listenbrainz,
  system: { neteaseRealIp, networkProxy, neteaseScrobbleEnabled, neteaseScrobbleMode }
}
```

### 5.10 Folders

`FolderBrowsePage`:

```ts
{
  path: string; root: string; parent: string | null; unavailable: boolean;
  associations?: { album?: Album; artist?: Artist };
  counts: { directories: number; media: number; materials: number; total: number };
  entries: FolderBrowseEntry[];
  previousCursor?: string; nextCursor?: string;
}
```

`FolderBrowseEntry` union: `directory` / `track` / `file` / `cue` / `sacd` / `material`.

## 6. HTTP endpoint reference

> General: Headless validation/command errors are usually `400 {error}`; the sample-processing gate is `409 {error:"output_processing_unavailable"}`; uncaught exceptions are Hono's default `500 text/plain`. Only key differences are listed below.

### 6.1 System, settings, filesystem, info

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/info` | — | `CoreInfo` | Version/capability negotiation |
| `GET /api/status` | — | `PlayerStatus` | Position/volume/output capability |
| `GET /api/settings/core` | — | `CoreSettingsSnapshot` | Core settings snapshot |
| `POST /api/settings/core` | `{keyPath*, value?}` | `{ok:true}` | Path allowlist; see below |
| `GET /api/filesystem/directories?path=` | `path?` | `CoreDirectoryListing` | Directory picker; can list host directories |
| `POST /api/system/network-proxy/test` | — | `{ok:boolean}` | Proxy test |
| `GET /api/proxy/image?url=` | `url*` | Image bytes | TIDAL/Qobuz image domains only; 5 MiB; 400/502 |

`POST /api/settings/core` allows:

- prefixes: `player.`, `lyric.`, `localLyric.`, `cache.songCache.`, `download.`, `listenbrainz.`, `system.networkProxy.`;
- exact paths: `streaming.enabled`, `system.neteaseRealIp`, `system.neteaseScrobbleEnabled`, `system.neteaseScrobbleMode`, `system.networkProxy`;
- rejects (dedicated endpoints): `player.outputDevice`, `player.volume`, `player.lyricOffsets`, `cache.dir`, `download.dir`;
- `library.*` cannot be changed here;
- value schema is not validated; unknown subkeys matching a prefix are persisted.

### 6.2 Library (Compat API)

#### Read, search, random

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/library/tracks` | — | `{data:Track[], total:number}` | Excludes CUE container whole tracks |
| `GET /api/library/albums` | — | `{data:AlbumSummary[]}` | |
| `GET /api/library/artists` | — | `{data:ArtistSummary[]}` | |
| `GET /api/library/albums/:albumId/tracks?name=` | `name?` | `{data:Track[]}` | Same-name album disambiguation |
| `GET /api/library/artists/:artistName/tracks` | path | `{data:Track[]}` | |
| `GET /api/library/tracks/by-ids?ids=` | `ids?` comma-separated | `{data:Track[]}` | Order not guaranteed |
| `GET /api/library/search?q=&type=&offset=&limit=` | `q?`; `type?` songs/albums/artists/playlists; `offset?`; `limit?` 0=all, max 500 | `{data,total}` | `playlists` always empty |
| `GET /api/library/random?limit=` | `limit?` 1..100, default 1 | `{data:Track[]}` | |
| `GET /api/library/random-one` | — | `{data:Track\|null}` | |
| `GET /api/library/count` | — | `{data:number}` | |

#### Scan directories and scan control

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/library/scan-dirs` | — | `{data:string[]}` | |
| `POST /api/library/scan-dirs` | `{dirs:string[]*}` | `{success:true,data:string[]}` | Writes config only; does not validate directories |
| `POST /api/library/scan-dirs/add` | `{dir*}` | `{success:true,data:string}` | realpath; 409 if exists |
| `DELETE /api/library/scan-dirs` | body `{dir*}` | `{success:true}` | Deletes DB rows, not files |
| `GET /api/library/is-scanning` | — | `{data:boolean}` | |
| `GET /api/library/scan-progress` | — | `{data:ScanProgress}` | phase is only scanning/done |
| `POST /api/library/scan` | `{incremental?:boolean=true}` | `{success:true}` | 409 if running |
| `POST /api/library/scan/cancel` | — | `{success:true}` | |

#### Likes, tags, avatars

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/library/liked` | — | `{data:string[]}` | |
| `POST /api/library/liked` | `{trackId*, liked:boolean*}` | `{success:true,data:string[]}` | Returns all IDs |
| `POST /api/library/liked/import` | `{trackIds:string[]*}` | `{success:true,data:string[]}` | |
| `POST /api/library/tags/read` | `{path*}` | `{success:true,data:TrackTags}` | |
| `POST /api/library/tags/write` | `{edits:TagEditRequest[]*}` | `{success:true,data:TagWriteOutcome[]}` | Known files only |
| `GET /api/library/artists/:artistName/avatar` | path | `{success:true,data:string\|null}` | `cache://artists/...` |
| `POST /api/library/artists/avatars` | `{names:string[]*}` | `{success:true,data:Record<string,string>}` | |

`TagEditRequest`: `path*`, `title?`, `artist?`, `album?`, `albumArtist?`, `year?`, `genre?`, `trackNumber?`, `discNumber?`, `lyrics?`, `coverPath?`, `coverUrl?`. `undefined` leaves a field unchanged; empty string/0 clears it.

### 6.3 Folders (Folder Browser)

All paths must be inside `library.scanDirs` and are re-checked with `realpath`. Error mapping:

- `FOLDER_CURSOR_STALE` → 409
- message contains `OUTSIDE_LIBRARY_ROOT` → 403
- message contains `NOT_FOUND` → 404
- otherwise → 400

#### Browse, container, search, pins

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/library/folders/roots` | — | `{roots:FolderRootEntry[],pins:FolderPinEntry[]}` | |
| `GET /api/library/folders/browse` | `path*`; `cursor?`; `limit?` default 200, 1..500; `focus?`; `filter?`; `sort?` name/mtime/track; `order?` asc/desc | `FolderBrowsePage` | Unreachable directory returns 200 + `unavailable:true` |
| `GET /api/library/folders/container?path=` | `path*` | `FolderContainerResult` | CUE/SACD expansion |
| `GET /api/library/folders/search` | `q?`; `cursor?`; `limit?` default 100, 1..200; `path?` | `FolderSearchPage` | Traverses at most 100,000 entries |
| `GET /api/library/folders/pins` | — | `FolderPinEntry[]` | Bare array |
| `POST /api/library/folders/pins` | `{path*}` | `FolderPinEntry[]` | |
| `DELETE /api/library/folders/pins` | `{path*}` | `FolderPinEntry[]` | |

#### Scan, location, playback, batch

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `POST /api/library/folders/scan` | `{path*, incremental:boolean*}` | `{ok:true}` | 409 if running |
| `POST /api/library/folders/location` | `{track:Track*}` | `FolderNavigationTarget` | |
| `POST /api/library/folders/play` | `{path*, recursive?:boolean=true}` | `FolderActionResult` | Replaces queue and plays |
| `POST /api/library/folders/shuffle` | same | `FolderActionResult` | Random start + shuffle on |
| `POST /api/library/folders/play-next` | same | `FolderActionResult` | Inserts after current |
| `POST /api/library/folders/queue` | same | `FolderActionResult` | Appends |
| `POST /api/library/folders/batch/play` | `{targets:FolderBatchTarget[]*}` | `FolderActionResult` | Non-recursive |
| `POST /api/library/folders/batch/play-next` | same | `FolderActionResult` | |
| `POST /api/library/folders/batch/queue` | same | `FolderActionResult` | |

`FolderBatchTarget`:

```ts
{ kind: "path", path: string }
| { kind: "container-track", containerPath: string, trackId: string }
```

`FolderActionResult`: `{ count: number, failed: string[] }`.

#### Add to playlist

| Method/path | Request | Success |
| --- | --- | --- |
| `POST /api/library/folders/playlist` | `{playlistId*, path*, recursive?:boolean=true}` | `FolderPlaylistResult` |
| `POST /api/library/folders/playlist-track` | `{playlistId*, containerPath*, trackId*}` | `FolderPlaylistResult` |
| `POST /api/library/folders/batch/playlist` | `{playlistId*, targets[]*}` | `FolderPlaylistResult` |

`FolderPlaylistResult`: `{ count, failed, added }`.

#### Materials and streams

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/library/folders/material/text?path=` | `path*` | `FolderTextMaterial` | Max 1 MiB |
| `GET /api/library/folders/material/thumbnail?path=` | `path*` | JPEG 320px | 404/400 |
| `GET /api/library/folders/directory/thumbnail?path=` | `path*` | JPEG 320px or empty 404 | |
| `GET /api/library/folders/material?path=` | `path*`; optional `Range` | File stream | 200/206/416 |

Material types: images (jpg/jpeg/png/webp/gif), PDF, text (txt/log/nfo/md). Magic bytes are checked; disguised files are ignored or return 400.

### 6.4 Playlists

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/playlists` | — | `PlaylistSummary[]` | Bare array |
| `GET /api/playlists/:id` | path | `PlaylistDetail\|null` | Missing returns null |
| `POST /api/playlists` | `{type:"local"*, title*, description?}` | `PlaylistSummary` | Empty title → 500 |
| `PATCH /api/playlists/:id` | `{title?, description?, cover?}` | `PlaylistSummary\|null` | Empty title → 500 |
| `DELETE /api/playlists/:id` | path | `{ok:true}` | Missing also succeeds |
| `POST /api/playlists/:id/tracks` | `{trackIds:string[]*}` | `{count:number}` | New tracks go to the front |
| `DELETE /api/playlists/:id/tracks` | `{trackIds:string[]*}` | `{count:number}` | |
| `POST /api/playlists/import-legacy` | `LegacyPlaylistRecord[]` | `{ok:true}` | `INSERT OR IGNORE` |
| `DELETE /api/playlists` | — | `{ok:true}` | Clear all |

### 6.5 Playback session

Unless stated otherwise, success responses are `Snapshot`.

| Method/path | Request | Notes |
| --- | --- | --- |
| `GET /api/session` | — | Authoritative session snapshot |
| `POST /api/session/migrate-legacy` | `{items*, originalItems*, index*, repeat*, shuffle*}` | Returns current snapshot if a queue already exists |
| `POST /api/session/reload` | `{forcePlay?:boolean}` | `{reloaded:boolean}`; failure is 200 |
| `POST /api/session/queue` | `{items*, startIndex?=0, autoPlay?=true, loadCurrent?=true}` | Replace queue |
| `POST /api/session/play-track` | `{track*, autoPlay?=true}` | Single track |
| `POST /api/session/queue/append` | `{items*}` | Append |
| `POST /api/session/queue/insert` | `{items*, index*}` | Insert |
| `POST /api/session/queue/move` | `{fromIndex*, toIndex*}` | Out-of-range is a no-op |
| `PATCH /api/session/queue/:index` | `{item*}` | Replace one item |
| `PATCH /api/session/queue/tracks` | `{tracks:Track[]*}` | **Currently shadowed by `/:index`, unreachable** |
| `DELETE /api/session/server/:serverId` | path | Remove tracks for that server |
| `POST /api/session/queue/select` | `{index*, loadCurrent?=true, autoPlay?=true}` | Select and load |
| `DELETE /api/session/queue/:index?loadCurrent=` | path; `loadCurrent` false only for `"0"` | Remove one item |
| `DELETE /api/session/queue` | — | Clear and stop |
| `POST /api/session/queue/clear` | `{stop?:boolean=false}` | Clears queue only by default |
| `POST /api/session/next` | `{loadCurrent?=true}` | Next |
| `POST /api/session/prev` | `{loadCurrent?=true}` | Previous; first track wraps to the end |
| `POST /api/session/repeat` | `{mode: off/list/one*}` | |
| `POST /api/session/shuffle` | `{mode: off/on*}` | |
| `POST /api/session/personal-fm` | `{options?, autoPlay?=true}` | Empty result broadcasts `NETEASE_UNAVAILABLE` |
| `POST /api/session/personal-fm/dislike` | `{playedSec?}` | Seconds |
| `POST /api/session/auto-close` | `{durationMin*, waitSongEnd?=false}` | Minimum 1 minute |
| `DELETE /api/session/auto-close` | — | Cancel |

Session notes:

- `autoPlay`/`loadCurrent` are disabled only by strict `false`; the string `"false"` is true.
- `DELETE /session/queue` stops output; `POST /session/queue/clear` does not by default.
- `stop()` does not clear the queue; `active` may remain true.
- `clearQueue` only clears NowPlaying track/detail, not position/state.
- Personal FM does not check NetEase login; an empty pool returns an empty queue and broadcasts an error.

### 6.6 Player control

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `POST /api/play` | — | `{ok:true}` | Load failure 400 |
| `POST /api/pause` | — | `{ok:true}` | Does not throw |
| `POST /api/stop` | — | `{ok:true}` | Does not clear the queue |
| `POST /api/seek` | `{positionMs*>=0}` | `{ok:true}` | Milliseconds |
| `POST /api/next` | — | `{ok:true}` | Load failure 400 |
| `POST /api/prev` | — | `{ok:true}` | |
| `GET /api/volume` | — | `{volume:number}` | 1 on Direct/UPnP |
| `POST /api/volume` | `{volume* 0..1}` | `{ok:true}` | 409 if processing unavailable; writes settings |
| `POST /api/player/load` | `{source*, options?:LoadOptions}` | `LoadResult` | **Legacy low-level endpoint**; bypasses session/resolution, do not use in normal Control |
| `POST /api/player/reinit` | — | `{success:true}` | No-op on UPnP/no active playback |
| `POST /api/player/speed` | `{speed*}` | `{ok:true}` | Native clamps 0.5..2.0 |
| `POST /api/player/pitch` | `{semitones?=0}` | `{ok:true}` | Native clamps -12..12 |
| `POST /api/player/pitch-sync` | `{enabled?}` | `{ok:true}` | Strict true only |
| `POST /api/player/normalization` | `{enabled?}` | `{ok:true}` | Strict true only |
| `POST /api/player/equalizer` | `{enabled?, bands?, preamp?}` | `{ok:true}` | 10 bands, -15..15; preamp -12..12 |
| `POST /api/player/fade` | `{durationMs?=0}` | `{ok:true}` | Negative becomes 0 |
| `GET /api/player/fade` | — | `{data:number}` | Milliseconds |
| `GET /api/player/cover` | — | `{data:string\|null}` | Data URL; MIME fixed to JPEG |
| `POST /api/player/read-lyric` | `{path*}` | `{data:string}` | Extension allowlist; can read arbitrary paths |
| `GET /api/player/alsa-mode` | — | `{mode:"direct"\|"processed"}` | |
| `POST /api/player/alsa-mode` | `{mode*}` | `{ok:true,mode}` | Transactional switch |

The sample-processing gate applies only to `/volume`, `speed`, `pitch`, `pitch-sync`, `normalization`, `equalizer`, and `fade`. These `/player/*` commands change runtime native state only and do not write settings (`/volume` is the exception).

### 6.7 Now Playing and lyrics

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/now-playing` | — | `NowPlayingSnapshot` | Includes track/detail/position/playing/state/speed/sendTimestamp |
| `POST /api/now-playing/lyric-offset/query` | `{trackId*, source?}` | `{offsetMs:number}` | Default 0 |
| `POST /api/now-playing/lyric-offset` | `{trackId*, source?, offsetMs?=0}` | `{ok:true}` | Clamp ±60,000; 0 deletes |
| `POST /api/lyrics/match-by-id` | `{platform*, id*}` | `LyricMatchResponse` | Unsupported platform returns 200 `{ok:false}` |
| `POST /api/lyrics/match-by-query` | `{platform*, track*}` | `LyricMatchResponse` | |
| `POST /api/lyrics/ttml-overlay` | `{platform:"netease"\|"qqmusic"*, track*}` | `LyricTTMLResponse` | |
| `POST /api/lyrics/local` | `{track*}` | `LyricTTMLResponse` | Local TTML library |

`NowPlayingSnapshot`:

```ts
{
  track: Track | null;
  detail: TrackDetail | null;
  position: number;   // ms
  playing: boolean;
  state: PlayerState;
  speed: number;
  sendTimestamp: number; // epoch ms
}
```

Lyric offset key: `trackId` + `|` + lyric source; a positive value advances lyrics.

### 6.8 Output devices

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/output/devices` | — | `{selected, alsaPlaybackMode, data:AudioDevice[]}` | Order: ALSA + Diretta + UPnP; Diretta scan failure fails the whole request |
| `POST /api/output/select` | `{deviceId: string\|null}` key required | `{ok:true, selected}` | Diretta requires root; UPnP requires `upnp:` prefix; failure 500 |
| `GET /api/output/scan` | — | `{success:true,data:AudioDevice[]}` | Native local list only; no Diretta/UPnP |

The `deviceChanged` event payload is always `{defaultDevice:null}`.

### 6.9 Cache

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/cache/stats` | — | `CacheStat[]` | covers/artists/backgrounds/songs/lyric/lyricTTML/lyricMatch |
| `GET /api/cache/dir` | — | `{dir}` | |
| `POST /api/cache/dir` | `{dir*}` | `CacheSwitchResult` | Target must exist and be empty; non-empty returns 200 `{ok:false,reason:"notEmpty"}` |
| `POST /api/cache/clear` | `{id:CacheCategory*}` | `{ok:true}` | |
| `POST /api/cache/clear-all` | `{kind:"file"\|"db"*}` | `{ok:true}` | |
| `POST /api/cache/reset-dir` | — | `{dir}` | Clears file cache, restores default |

`CacheStat.path` for DB categories is a table name, not a path. DB size counts only `length()` of selected fields, excluding indexes/pages.

### 6.10 Downloads

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/download/tasks` | — | `DownloadTask[]` | Newest first |
| `GET /api/download/dir` | — | `{dir}` | |
| `POST /api/download/dir` | `{dir*}` | `{dir}` | realpath |
| `POST /api/download/reset-dir` | — | `{dir}` | |
| `POST /api/download/start` | `DownloadRequest` | `EnqueueResult` | 400 `download_request_invalid` |
| `POST /api/download/start-many` | `DownloadRequest[]` | `EnqueueResult[]` | Empty array allowed |
| `POST /api/download/cancel` | `{taskId*}` | `{ok:true}` | Unknown ID also succeeds |
| `POST /api/download/remove` | `{taskId*}` | `{ok:true}` | Does not delete completed files |
| `POST /api/download/clear-finished` | — | `{ok:true}` | |

Dedup key: `track.source:track.id:qualityLevel`; if queued or downloaded, returns `{ok:false,reason:"queued"|"downloaded"}` (HTTP 200). Downloads are serial; `errorCode` is currently always `UNKNOWN`.

### 6.11 Plugins

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/plugins` | — | `PluginInfo[]` | |
| `POST /api/plugins/install-url` | `{url*}` | `{ok,id?,error?}` | HTTPS/loopback HTTP only; ≤9MB |
| `POST /api/plugins/:id/uninstall` | path | `{ok,error?}` | Failure also 200 |
| `POST /api/plugins/:id/enabled` | `{enabled:boolean*}` | `{ok:true}` | |
| `POST /api/plugins/:id/setting` | `{key*, value?}` | `{ok:true}` | |
| `POST /api/plugins/:id/check-update` | path | `{ok,hasUpdate,plugin?,error?}` | |
| `POST /api/plugins/:id/apply-update` | path | `{ok,plugin?,error?,fallbackUrl?}` | No updateUrl → `PLUGIN_NO_UPDATE_URL` |
| `POST /api/plugins/resolve-url` | `PluginResolveUrlArgs` | `MusicUrlRes` | |
| `POST /api/plugins/invoke-menu` | `PluginInvokeMenuArgs` | `PluginInvokeMenuResult` | |
| `POST /api/plugins/match-lyric` | `PluginMatchLyricArgs` | `PluginMatchLyricResult` | |
| `POST /api/plugins/match-cover` | `PluginMatchCoverArgs` | `PluginMatchCoverResult` | |

Plugin status changes are pushed via WS `pluginStatus`. Plugins run in a separate host child process; permissions are controlled by `@grant`.

### 6.12 Streaming servers

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/streaming/config` | — | `StreamingConfigSnapshot` | No passwords |
| `POST /api/streaming/server` | `StreamingServerInput*` | `StreamingServerConfig` | Missing fields may 500 |
| `PATCH /api/streaming/server/:serverId` | `StreamingServerInput*` | `StreamingServerConfig` | |
| `DELETE /api/streaming/server/:serverId` | path | `{ok:true}` | Cascades snapshot deletion |
| `POST /api/streaming/active` | `{serverId?:string\|null}` | `StreamingConfigSnapshot` | Connect failure still 200; active already set |
| `POST /api/streaming/test` | `{input*, serverId?}` | `StreamingPingResult` | Failure also 200 |
| `POST /api/streaming/connect` | `{serverId*}` | `StreamingConnectResult` | Failure also 200 |
| `POST /api/streaming/disconnect` | `{serverId*}` | `{ok:true}` | |
| `GET /api/streaming/snapshot?serverId=` | `serverId*` | `StreamingLibrarySnapshot` | Unknown ID returns empty arrays |
| `POST /api/streaming/sync` | `{serverId*, force?=false}` | `{started:boolean}` | Already running/synced returns false |
| `GET /api/streaming/search?serverId=&query=` | `serverId*`; `query?` | `StreamingSearchResult` | Query truncated to 200 chars |
| `GET /api/streaming/album-songs?serverId=&albumId=` | both required | `Track[]` | |
| `GET /api/streaming/playlist-songs?serverId=&playlistId=` | both required | `Track[]` | |
| `GET /api/streaming/artist-albums?serverId=&artistId=` | both required | `Album[]` | |
| `GET /api/streaming/artist-songs?serverId=&artistId=` | both required | `Track[]` | |
| `POST /api/streaming/lyrics` | `{serverId*, trackId*, hint?}` | `{lyric:string\|null}` | |
| `GET /api/streaming/cover?serverId=&coverId=&size=` | `serverId*`,`coverId*`; `size?` default 300, 32..2000 | Image bytes | Missing params 400 empty body; no cover 204; Content-Type fixed octet-stream |

### 6.13 Online providers

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `POST /api/providers/call` | `{platform*, name*, params?}` | `ApiCallResponse` | Upstream failure still 200 `{ok:false}` |
| `GET /api/providers/sessions` | — | `ProviderSessionsSnapshot` | No credentials |
| `POST /api/providers/clear-session` | `{platform*}` | `{ok:true}` | Qobuz/TIDAL logout network failure may 500 |
| `POST /api/providers/set-cookie` | `{platform*, cookie*}` | `{ok}` | NCM/QM/KG only |

`platform` must be `netease|qqmusic|kugou|qobuz|tidal`. `name` is the provider method name; the route does not enumerate it.

Session determination:

- NetEase: `MUSIC_U` present.
- QQ: `uin` non-empty and not `"0"`, plus a login key.
- Kugou: `token` + `userid`.
- Qobuz/TIDAL: their own auth state.

### 6.14 Comments

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/comments/sources` | — | `CommentSource[]` | Built-in NCM/QM/KG + plugin sources |
| `POST /api/comments/music` | `MusicCommentQuery` | `{ok:true,data:MusicCommentPage}` | Upstream error still 200 `{ok:false}` |

`MusicCommentQuery`: `{sourceId*, track*, type:"hot"|"new"*, page?, limit?, cursor?}`. `limit` defaults to 20, max 50. Kugou supports hot only; `new` returns empty.

### 6.15 Stats

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/stats/summary` | — | `PlayStatsSummary` | DB failure returns all zeros |
| `GET /api/stats/library` | — | `LibraryStats` | |
| `GET /api/stats/top-tracks?limit=` | `limit?` 1..100 | `TopTrack[]` | Excludes streaming |
| `GET /api/stats/daily?days=` | `days?` 1..365, default 30 | `DailyPlayStats[]` | Only days with records |
| `GET /api/stats/hourly` | — | `HourlyPlayStats[]` | Always 24 entries |
| `GET /api/stats/top-albums?limit=` | `limit?` | `TopAlbum[]` | Excludes streaming |
| `GET /api/stats/top-artists?limit=` | `limit?` | `TopArtist[]` | Excludes streaming |
| `POST /api/stats/favorite` | `{track*, action:"add"\|"remove"*}` | `{ok:true}` | Server uses current time |

Week starts Monday 00:00 local time; daily/hourly use local time.

### 6.16 ListenBrainz

| Method/path | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/listenbrainz/status` | — | `ListenBrainzStatus` | No token |
| `PUT /api/listenbrainz/link` | `{token*}` | `ListenBrainzStatus` | Must be enabled; 15s validation |
| `DELETE /api/listenbrainz/link` | — | `ListenBrainzStatus` | |
| `POST /api/listenbrainz/outbox/clear` | — | `ListenBrainzStatus` | 400 if disabled/no child |

`ListenBrainzStatus`: `{enabled,sendNowPlaying,linked,account,state,pending,dead,lastError,processActive}`.

### 6.17 Static assets, images, cache files

| Path | Behavior |
| --- | --- |
| `GET /` | `renderer/index.html`, `no-store` |
| `GET /debug` | Same index.html; frontend mounts the debug app |
| `GET /*` | `serveStatic(renderer)`; no SPA history fallback |
| `GET /cache/covers/*` | Cover cache; attempts repair when missing |
| `GET /cache/artists/*` | Artist image cache |
| `GET /cache/backgrounds/*` | Background cache |

The frontend uses hash routing, so deep links look like `/#/songs` and need no server fallback.

Image endpoints:

| Endpoint | Limits | Cache header |
| --- | --- | --- |
| `GET /api/proxy/image` | TIDAL/Qobuz image domains only; 5 MiB; 10s; no redirects | `public, max-age=86400` |
| `GET /api/streaming/cover` | 5 MiB; 15s; size 32..2000 | `private, max-age=300` |
| `GET /api/library/folders/material/thumbnail` | 320px JPEG | `private, max-age=300` |
| `GET /api/library/folders/directory/thumbnail` | 320px JPEG; no image 404 | `private, max-age=300` |
| `GET /api/library/folders/material` | Raw file stream; Range | `private, max-age=300` |
| `GET /api/player/cover` | base64 data URL; MIME fixed JPEG | None |

## 7. WebSocket contract

### 7.1 Connection

```text
ws://<core-host>:14558/ws
wss://<core-host>/ws        # TLS reverse proxy
```

- No authentication, query token, or subprotocol negotiation.
- The upgrade request passes the Host/Origin guard.
- No application-level ping/pong; `ws` default `maxPayload=100 MiB`.
- On server stop, close code `1001`, reason `Core server stopping`, terminate after 1 second.

### 7.2 Message formats

Server → Client:

```json
{ "kind": "hello", "clients": 3 }
{ "kind": "event", "type": "status", "data": { } }
{ "kind": "ack", "op": "play" }
{ "kind": "error", "op": "seek", "error": "positionMs (number, >=0) required" }
```

Client → Server:

```json
{ "op": "play" | "pause" | "stop" | "next" | "prev" | "seek" | "setVolume", ... }
```

### 7.3 Client commands

| op | Parameters | Validation | Behavior |
| --- | --- | --- | --- |
| `play` | — | none | `play()`; immediate ack; failure not reported |
| `pause` | — | none | `pause()`; immediate ack |
| `stop` | — | none | `stop()`; immediate ack |
| `next` | — | none | `next()`; immediate ack; failure not reported |
| `prev` | — | none | `prev()`; immediate ack |
| `seek` | `positionMs:number` | finite and `>=0` | ack/error after completion |
| `setVolume` | `volume:number` | finite and 0..1 | error if processing unavailable; **does not write settings** |
| unknown | — | — | `{kind:"error",op:...,error:"unknown op"}` |
| invalid JSON | — | — | `{kind:"error",op:"?",error:"invalid json"}` |

Edge cases:

- `Number(null) === 0`, so `seek`/`setVolume` with null are accepted as 0.
- Numeric strings are accepted.
- `play/pause/stop/next/prev` ack does not mean playback succeeded; real failures appear as later `status`/`error`/`session` events.
- A top-level JSON `null` may produce no error frame (code defect).

### 7.4 Server events

| type | data | Trigger |
| --- | --- | --- |
| `status` | `PlayerStatus` | Native stateChanged, loading, UPnP observation |
| `trackLoaded` | `{track, context?, source, autoPlay, detail?, mediaInfo?}` | Session load / gapless boundary |
| `position` | `{position,duration}` | **Filtered by WS; external clients never receive it** |
| `error` | `{error:string}` | Load failure |
| `deviceChanged` | `{defaultDevice:null}` | Output switch success |
| `session` | `PlaybackSessionSnapshot` | Any session publish |
| `providerSessions` | `ProviderSessionsSnapshot` | Login state change |
| `libraryScanProgress` | `ScanProgress` | Scan start/progress/end/cancel |
| `libraryChanged` | `{revision:number}` | Library content change |
| `libraryLikesChanged` | `{ids:string[]}` | Likes change |
| `libraryRootsChanged` | `{paths:string[]}` | Scan directory change |
| `folderPinsChanged` | `{paths:string[]}` | Pinned folder change |
| `downloadState` | `DownloadTask` | Task status change |
| `downloadProgress` | `{taskId,received,total}` | 250ms throttled |
| `streamingConfigUpdated` | `StreamingConfigSnapshot` | Server add/edit/delete/activate/connect |
| `streamingLibraryUpdated` | `{serverId}` | Streaming library sync |
| `lyricOffset` | `{trackId,source,offsetMs}` | Lyric offset change |
| `pluginStatus` | `PluginInfo` | Plugin status change |
| `ended` | `{consumedBySession:boolean}` | Native end |
| `directTrackBoundary` | `{duration,generation}` | Direct boundary not consumed |
| `processedTrackBoundary` | `{duration,generation}` | Processed boundary not consumed |
| `sourceError` | `{consumedBySession:boolean}` | Native source error |

Not sent:

- Command-type `PlayerEvent` values (`seek`, `play`, `pause`, `next`, `prev`, `playTrack`, `setShuffle`, `setRepeat`, `addToQueue`, `toggleLike`) are not broadcast.
- `position` is explicitly filtered by `HIGH_FREQ_EVENTS`.

Delivery characteristics:

- No subscription filtering, no event sequence, no replay; events during a disconnect are lost.
- `hello` and subsequent events have no strict ordering guarantee.
- The client set is an in-process `Set`; clients that fail to send are removed.
- `clients` is reported only at connect; later count changes are not broadcast.

## 8. Units and ranges

| Field | Unit/range |
| --- | --- |
| `Track.duration` | milliseconds |
| `Track.cueStartMs`/`cueEndMs` | milliseconds |
| `Track.cueStartFrame75`/`cueEndFrame75` | 75fps frames |
| `Track.fileSize` | bytes |
| `Track.mtime`/`ctime` | Unix ms |
| `Track.quality.sampleRate` | Hz |
| `Track.quality.bitRate` | bps |
| `PlayerStatus.position`/`duration` | milliseconds (after CUE projection) |
| `PlayerStatus.volume` | 0..1 |
| `PlayerStatus.speed` | multiplier; native clamps 0.5..2.0 |
| `seek.positionMs` | milliseconds |
| `pitch.semitones` | semitones; native clamps -12..12 |
| `equalizer.bands` | 10 dB values, -15..15 |
| `equalizer.preamp` | dB, -12..12 |
| `fade.durationMs` | milliseconds |
| `autoClose.durationMin` | minutes, min 1 |
| `autoClose.endTime` | epoch ms |
| `NowPlaying.position` | milliseconds |
| `NowPlaying.sendTimestamp` | epoch ms |
| `lyricOffset.offsetMs` | milliseconds, ±60,000; positive advances |
| `DownloadTask.received`/`total` | bytes |
| `DownloadTask.createdAt`/`finishedAt` | epoch ms |
| `CacheStat.size` | bytes |
| `PlayStatsSummary.*Ms` | milliseconds |
| `LibraryStats.totalFileSize` | bytes |
| `DailyPlayStats.day` | local `YYYY-MM-DD` |
| `HourlyPlayStats.hour` | local 0..23 |
| `ScanProgress.total`/`scanned` | file count |
| `FolderBrowseEntry.mtime` | Unix ms |
| `FolderBrowseEntry.size` | bytes |
| `ListenBrainzTrackSnapshot.listenedAt` | Unix seconds |
| `ListenBrainzTrackSnapshot.durationMs` | milliseconds |

Native internals use **seconds** for position/duration/seek; Core converts at the boundary.

## 9. Client implementation guidance

### 9.1 Handshake

```text
GET /api/info
→ validate protocol.version in [1,1]
→ connect /ws
→ GET /api/session and GET /api/status in parallel
→ initialize UI from session/status
→ subscribe to WS events
→ GET /api/status every 500ms while visible
```

### 9.2 State principles

- `/api/session` is the authoritative snapshot for queue/index/mode.
- `/api/status` is the authoritative snapshot for position/state/output capability.
- On a WS `session` event, replace the local queue wholesale; do not guess increments.
- On `trackLoaded`, update the current track; if missed, verify with `/api/now-playing`.
- WS does not push `position`; poll `/api/status`.

### 9.3 Reconnect

- Network error: reconnect after 1 second.
- Incompatible protocol: stop reconnecting and prompt for an upgrade.
- After reconnect, re-fetch `/api/session` and `/api/status`; do not assume events during the gap were replayed.

### 9.4 Resource URLs

- `cache://covers/a.jpg` → `<origin>/cache/covers/a.jpg`
- `streaming-cover://image?serverId=...&coverId=...&size=...` → `<origin>/api/streaming/cover?...`
- When submitting a Track back to Core, use canonical `cache://` / `streaming-cover://`, not display HTTP URLs.

### 9.5 Command confirmation

- WS ack for play/pause/next/prev only means the command was dispatched, not that loading succeeded.
- Determine the outcome from `status`/`session`/`trackLoaded`/`error` events.
- HTTP playback commands return 400 on failure; do not rely on ack alone.

### 9.6 Error handling

- `OUTPUT_DEVICE_REQUIRED`: open the output selector.
- `OUTPUT_FORMAT_UNSUPPORTED`: tell the user the current output does not support the format; do not auto-downgrade.
- `NETEASE_*`/`PROVIDER_*`: classify entitlement/login/unavailable.
- `LOAD_SUPERSEDED`: ignore silently (normal race during fast skipping).

## 10. Compatibility and known issues

| Issue | Impact | Workaround |
| --- | --- | --- |
| `PATCH /api/session/queue/tracks` shadowed by `/:index` | Endpoint unreachable; returns `valid index and item required` | Update items individually or replace the whole queue |
| `capabilities.remoteOutput` always false | Cannot be used to decide UPnP availability | Call `/api/output/devices` |
| Server does not reject routes by capability | Capability is not a security/behavior switch | UI hints only |
| WS does not push `position` | Position-dependent apps freeze | Poll `/api/status` |
| `deviceChanged.data` always `{defaultDevice:null}` | Event does not carry the new device | Re-fetch `/api/output/devices` |
| `stop()` does not clear the queue | `/api/status` may still be active | Call `DELETE /api/session/queue` to clear |
| `prev()` wraps at the first track | Inconsistent with repeat=off | Client-side boundary check |
| `POST /session/queue/clear` does not stop by default | Audio may continue | Pass `{stop:true}` |
| `personal-fm` does not check login | Empty queue + error event when logged out | Check provider session first |
| `GET /api/streaming/cover` 400 empty body on missing params | Cannot parse as JSON | Handle by status code |
| `GET /api/player/cover` MIME fixed JPEG | PNG/WebP also labeled JPEG | Browsers usually render it |
| `/api/player/read-lyric` reads arbitrary paths | Trusted-LAN exposure | Do not expose to the internet |
| `/api/library/scan-dirs` does not validate directories | Arbitrary/nonexistent paths can be stored | Use the directory picker |
| `/api/settings/core` does not validate value schema | Unknown subkeys persist | Client-side type/range checks |
| No global body limit | Large requests can consume memory | Reverse-proxy `client_max_body_size` |
| No auth/TLS | Any reachable client can control | Network isolation/proxy auth |
| `remoteOutput`/`diretta` static bits | Do not reflect current availability | Use device scan/playback result |

## 11. Examples

### 11.1 Query info

```bash
curl -s http://127.0.0.1:14558/api/info | jq
```

### 11.2 Query session

```bash
curl -s http://127.0.0.1:14558/api/session | jq '.index, .current.title, .repeat, .shuffle'
```

### 11.3 Play a single track

```bash
curl -s -X POST http://127.0.0.1:14558/api/session/play-track \
  -H 'Content-Type: application/json' \
  -d '{"track":{"id":"...","source":"local","title":"...","artists":[],"duration":0},"autoPlay":true}'
```

### 11.4 Set volume

```bash
curl -s -X POST http://127.0.0.1:14558/api/volume \
  -H 'Content-Type: application/json' \
  -d '{"volume":0.5}'
```

### 11.5 Select output

```bash
curl -s -X POST http://127.0.0.1:14558/api/output/select \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"alsa:hw:CARD=USB,DEV=0"}'
```

### 11.6 Minimal WebSocket client (Node)

```js
import WebSocket from "ws";

const base = "http://127.0.0.1:14558";
const info = await (await fetch(`${base}/api/info`)).json();
if (info.protocol.version !== 1) throw new Error("incompatible Core protocol");

const ws = new WebSocket("ws://127.0.0.1:14558/ws");

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.kind === "hello") console.log("clients", msg.clients);
  if (msg.kind === "event") console.log("event", msg.type);
  if (msg.kind === "error") console.error("error", msg.op, msg.error);
});

ws.on("open", async () => {
  const session = await (await fetch(`${base}/api/session`)).json();
  console.log("queue", session.queue.length, "index", session.index);
  ws.send(JSON.stringify({ op: "play" }));
});
```

### 11.7 Poll status

```js
setInterval(async () => {
  const status = await (await fetch("http://127.0.0.1:14558/api/status")).json();
  console.log(status.state, status.position, status.output.path);
}, 500);
```

## 12. Endpoint index

```text
GET    /api/info
GET    /api/status
GET    /api/settings/core
POST   /api/settings/core
GET    /api/filesystem/directories
POST   /api/system/network-proxy/test
GET    /api/proxy/image

GET    /api/library/tracks
GET    /api/library/albums
GET    /api/library/artists
GET    /api/library/albums/:albumId/tracks
GET    /api/library/artists/:artistName/tracks
GET    /api/library/tracks/by-ids
GET    /api/library/search
GET    /api/library/random
GET    /api/library/random-one
GET    /api/library/count
GET    /api/library/scan-dirs
POST   /api/library/scan-dirs
POST   /api/library/scan-dirs/add
DELETE /api/library/scan-dirs
GET    /api/library/is-scanning
GET    /api/library/scan-progress
POST   /api/library/scan
POST   /api/library/scan/cancel
GET    /api/library/liked
POST   /api/library/liked
POST   /api/library/liked/import
POST   /api/library/tags/read
POST   /api/library/tags/write
GET    /api/library/artists/:artistName/avatar
POST   /api/library/artists/avatars

GET    /api/library/folders/roots
GET    /api/library/folders/browse
GET    /api/library/folders/container
GET    /api/library/folders/search
GET    /api/library/folders/pins
POST   /api/library/folders/pins
DELETE /api/library/folders/pins
POST   /api/library/folders/scan
POST   /api/library/folders/location
POST   /api/library/folders/play
POST   /api/library/folders/shuffle
POST   /api/library/folders/play-next
POST   /api/library/folders/queue
POST   /api/library/folders/batch/play
POST   /api/library/folders/batch/play-next
POST   /api/library/folders/batch/queue
POST   /api/library/folders/playlist
POST   /api/library/folders/playlist-track
POST   /api/library/folders/batch/playlist
GET    /api/library/folders/material/text
GET    /api/library/folders/material/thumbnail
GET    /api/library/folders/directory/thumbnail
GET    /api/library/folders/material

GET    /api/playlists
GET    /api/playlists/:id
POST   /api/playlists
PATCH  /api/playlists/:id
DELETE /api/playlists/:id
POST   /api/playlists/:id/tracks
DELETE /api/playlists/:id/tracks
POST   /api/playlists/import-legacy
DELETE /api/playlists

GET    /api/session
POST   /api/session/migrate-legacy
POST   /api/session/reload
POST   /api/session/queue
POST   /api/session/play-track
POST   /api/session/queue/append
POST   /api/session/queue/insert
POST   /api/session/queue/move
PATCH  /api/session/queue/:index
PATCH  /api/session/queue/tracks
DELETE /api/session/server/:serverId
POST   /api/session/queue/select
DELETE /api/session/queue/:index
DELETE /api/session/queue
POST   /api/session/queue/clear
POST   /api/session/next
POST   /api/session/prev
POST   /api/session/repeat
POST   /api/session/shuffle
POST   /api/session/personal-fm
POST   /api/session/personal-fm/dislike
POST   /api/session/auto-close
DELETE /api/session/auto-close

POST   /api/play
POST   /api/pause
POST   /api/stop
POST   /api/seek
POST   /api/next
POST   /api/prev
GET    /api/volume
POST   /api/volume
POST   /api/player/load
POST   /api/player/reinit
POST   /api/player/speed
POST   /api/player/pitch
POST   /api/player/pitch-sync
POST   /api/player/normalization
POST   /api/player/equalizer
POST   /api/player/fade
GET    /api/player/fade
GET    /api/player/cover
POST   /api/player/read-lyric
GET    /api/player/alsa-mode
POST   /api/player/alsa-mode

GET    /api/now-playing
POST   /api/now-playing/lyric-offset/query
POST   /api/now-playing/lyric-offset
POST   /api/lyrics/match-by-id
POST   /api/lyrics/match-by-query
POST   /api/lyrics/ttml-overlay
POST   /api/lyrics/local

GET    /api/output/devices
POST   /api/output/select
GET    /api/output/scan

GET    /api/cache/stats
GET    /api/cache/dir
POST   /api/cache/dir
POST   /api/cache/clear
POST   /api/cache/clear-all
POST   /api/cache/reset-dir

GET    /api/download/tasks
GET    /api/download/dir
POST   /api/download/dir
POST   /api/download/reset-dir
POST   /api/download/start
POST   /api/download/start-many
POST   /api/download/cancel
POST   /api/download/remove
POST   /api/download/clear-finished

GET    /api/plugins
POST   /api/plugins/install-url
POST   /api/plugins/:id/uninstall
POST   /api/plugins/:id/enabled
POST   /api/plugins/:id/setting
POST   /api/plugins/:id/check-update
POST   /api/plugins/:id/apply-update
POST   /api/plugins/resolve-url
POST   /api/plugins/invoke-menu
POST   /api/plugins/match-lyric
POST   /api/plugins/match-cover

GET    /api/streaming/config
POST   /api/streaming/server
PATCH  /api/streaming/server/:serverId
DELETE /api/streaming/server/:serverId
POST   /api/streaming/active
POST   /api/streaming/test
POST   /api/streaming/connect
POST   /api/streaming/disconnect
GET    /api/streaming/snapshot
POST   /api/streaming/sync
GET    /api/streaming/search
GET    /api/streaming/album-songs
GET    /api/streaming/playlist-songs
GET    /api/streaming/artist-albums
GET    /api/streaming/artist-songs
POST   /api/streaming/lyrics
GET    /api/streaming/cover

POST   /api/providers/call
GET    /api/providers/sessions
POST   /api/providers/clear-session
POST   /api/providers/set-cookie

GET    /api/comments/sources
POST   /api/comments/music

GET    /api/stats/summary
GET    /api/stats/library
GET    /api/stats/top-tracks
GET    /api/stats/daily
GET    /api/stats/hourly
GET    /api/stats/top-albums
GET    /api/stats/top-artists
POST   /api/stats/favorite

GET    /api/listenbrainz/status
PUT    /api/listenbrainz/link
DELETE /api/listenbrainz/link
POST   /api/listenbrainz/outbox/clear
```

## 13. Error codes

`ErrorCode` is used mainly for playback loading, WS error events, playback failures, and download failures:

| code | Meaning |
| --- | --- |
| `DEVICE_NOT_FOUND` | Output device not found |
| `DEVICE_INIT_FAILED` | Device initialization failed |
| `OUTPUT_DEVICE_REQUIRED` | No output selected |
| `FILE_NOT_FOUND` | File missing/inaccessible |
| `FILE_NO_AUDIO_STREAM` | No audio stream |
| `FILE_DECODE_ERROR` | Decode failed |
| `FILE_NOT_SELECTED` | User cancelled selection |
| `NETWORK_ERROR` | Source connection failed |
| `NETWORK_TIMEOUT` | Source timeout |
| `URL_RESOLVE_FAILED` | Official + plugin both failed |
| `NO_PLUGIN_AVAILABLE` | No plugin available |
| `NETEASE_LOGIN_EXPIRED` | NetEase login expired |
| `NETEASE_VIP_REQUIRED` | NetEase membership |
| `NETEASE_PURCHASE_REQUIRED` | NetEase purchase |
| `NETEASE_TRIAL_DISABLED` | NetEase trial disabled |
| `NETEASE_UNAVAILABLE` | NetEase no source |
| `PROVIDER_VIP_REQUIRED` | Other provider membership |
| `PROVIDER_PURCHASE_REQUIRED` | Other provider purchase |
| `PROVIDER_TRIAL_DISABLED` | Other provider trial disabled |
| `PROVIDER_UNAVAILABLE` | Other provider no source |
| `PROVIDER_LOGIN_REQUIRED` | Login required |
| `OUTPUT_FORMAT_UNSUPPORTED` | Output rejects format |
| `TAG_READ_FAILED` | Tag read failed |
| `TAG_WRITE_FAILED` | Tag write failed |
| `SCAN_NO_DIRS` | No scan directories |
| `SCAN_DIR_EXISTS` | Directory already exists |
| `SCAN_DIR_NOT_FOUND` | Directory not found |
| `SCAN_DIR_NOT_SELECTED` | User cancelled selection |
| `LOAD_SUPERSEDED` | Load superseded by a newer operation |
| `MAX_CONSECUTIVE_FAILURES` | Consecutive failure limit reached |
| `UNKNOWN` | Unknown error |

## 14. Quick contract summary

- Server: Hono + @hono/node-server + ws; `0.0.0.0:14558`; HTTP and WS share the port.
- All APIs are under `/api`; responses are JSON except images/streams/plain-text errors/204/400 empty body.
- No authentication; the Host/Origin guard is not authentication.
- No CORS in production; development `ATOM_WEB_DEV_URL` makes `/api/*` `*`.
- Version negotiation only uses `/api/info.protocol.version`, range `1..1`.
- Capabilities are UI hints; `remoteOutput` is always false.
- Playback authority is `/api/session`; position is polled from `/api/status`.
- Playback/queue successes are generally a full `Snapshot`.
- Time in ms, volume 0..1, speed multiplier, auto-close minutes.
- Image URLs use `cache://` / `streaming-cover://`.
- Do not depend on `PATCH /api/session/queue/tracks` (currently shadowed).

## 15. Related documents

- [Project Book](./01-project.md)
- [Development Manual](./02-development.md)
- [Operations Manual](./03-operations.md)
- [User Guide](./04-user-guide.md)
- [Type reference (existing)](../types.md)
- [Plugin development](../plugins/)
- [Core deployment](../core-deployment.md)
