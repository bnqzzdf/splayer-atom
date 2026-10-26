# SPlayer Atom 程序接口文档

> 最后更新：2026-10-26
>
> 代码基线：`dev` 分支提交 `5693b3fc`，产品版本 `1.1.3`
>
> 适用对象：Web Control 开发者、自动化脚本作者、第三方集成方

## 1. 概览

SPlayer Atom Core 在同一个端口上提供：

- **HTTP API**：`http://<core-host>:14558/api/...`
- **WebSocket**：`ws://<core-host>:14558/ws`
- **Web Control 静态站点**：`http://<core-host>:14558/`
- **缓存图片**：`http://<core-host>:14558/cache/...`

当前约有 **179 条 HTTP 路由**，分为：

| 路由组 | 前缀 | 说明 |
| --- | --- | --- |
| Headless Control | `/api` | 播放会话、播放器、设置、缓存、下载、插件、流媒体、在线平台、歌词、统计、ListenBrainz |
| Folder Browser | `/api/library/folders` | Core 主机文件系统浏览与批量操作 |
| Compat API | `/api/library`、`/api/playlists`、`/api/output` | 曲库、歌单、输出扫描等兼容接口 |

HTTP 与 WebSocket 同端口、同进程。生产环境 Core 直接托管 Web Control；开发环境 Web 由 Vite 提供，前端访问 Core 的另一个端口。

### 1.1 协议版本

- Core Protocol：`1`（`GET /api/info.protocol.version`）。
- Control 接受范围：`1..1`。
- 不兼容时客户端应停止重连并提示升级，而不是猜测 API 能力。

### 1.2 本文约定

- `*` 表示必填，`?` 表示可选。
- `Snapshot` 指 `PlaybackSessionSnapshot`。
- 时间默认毫秒；音量 `0..1`；速度是倍率；自动关闭时长是分钟。
- 代码证据以仓库相对路径给出。

## 2. 请求入口、安全与限制

### 2.1 鉴权

**Core 没有鉴权。** 没有 `Authorization`、API key、Cookie 会话或 CSRF token。

`requestGuard` 只做两件事：

1. **Host 校验**：放行任意 IP、`localhost`、无点主机名、`.local`/`.lan`/`.home.arpa`/`.internal`/`.localdomain`，以及 `ATOM_ALLOWED_HOSTS` 中的精确主机名；其他公网域名返回 `403 untrusted host`。
2. **Origin 校验**：无 `Origin` 放行；`Origin: null` 拒绝；正常 Origin 必须与 `Host` 完全一致（开发模式 `ATOM_WEB_DEV_URL` 下允许同主机名任意端口）；否则 `403 cross-origin request rejected`。

这不是身份认证。任何能直连端口的非浏览器客户端都可以控制播放、修改设置、安装插件、写入 Cookie。部署必须依赖网络边界（LAN/VLAN/防火墙）或带认证的反向代理。

### 2.2 绑定与端口

- 监听地址：`0.0.0.0`。
- 默认端口：`14558`，可用 `ATOM_SERVER_PORT` 覆盖。
- HTTP 与 WS 同端口。

### 2.3 CORS

- 生产：无 CORS 头，只支持同源。
- 开发：设置 `ATOM_WEB_DEV_URL` 后，`/api/*` 返回 `Access-Control-Allow-Origin: *`，不启用 credentials。
- `/ws`、`/cache/*`、静态资源不受 CORS 中间件影响，但仍受 Host/Origin 守卫。

### 2.4 请求体与内容类型

- 没有全局 `bodyLimit`，没有 413 处理。
- `c.req.json()` 不校验 `Content-Type`；`text/plain` 也会被当 JSON 解析。
- 多数端点用 `c.req.json().catch(() => null)`，坏 JSON 进入字段校验（通常 400）；少数直接 `await c.req.json()` 的端点（如创建歌单）坏 JSON 会返回 Hono 默认 500 纯文本。
- 单端点限制：
  - 图片代理：5 MiB、10 秒、禁止重定向；
  - 流媒体封面：5 MiB、15 秒；
  - 插件安装脚本：9,000,000 字节、15 秒、仅 HTTPS 或 loopback HTTP；
  - 文件夹文本预览：1 MiB；
  - 文件夹原始材料流：无总体大小限制，支持 Range；
  - `/api/player/read-lyric`：无文件大小限制。

### 2.5 压缩与缓存头

- 无压缩中间件。
- 静态文件无 `Cache-Control`、无 ETag，只有 `Last-Modified`。
- `/` 与 `/debug` 返回 `Cache-Control: no-store`。
- 图片代理 `public, max-age=86400`；流媒体封面/文件夹缩略图 `private, max-age=300`。

## 3. 错误模型

Core 没有统一错误 envelope。客户端必须按端点处理：

| 形态 | 来源 | 示例 |
| --- | --- | --- |
| `{ "error": string }` | Headless 命令/校验 | `400 {"error":"volume (number, 0..1) required"}` |
| `{ "success": false, "error": string }` | Compat API | `400 {"success":false,"error":"dir_required"}` |
| `{ "ok": false, "error": string }` | providers/comments/plugins | `200 {"ok":false,"error":"..."}` |
| 纯文本 | Host/Origin 守卫、Hono 404/500 | `403 untrusted host` |
| 空 body | 部分图片/流端点 | `/api/streaming/cover` 缺参 400 空 body；无封面 204 |

### 3.1 HTTP 状态码约定

| 状态 | 含义 |
| --- | --- |
| `200` | 成功；也可能是业务失败（providers/comments/plugins/streaming test/connect、下载重复、缓存目录非空） |
| `204` | 无内容（流媒体封面无图） |
| `400` | 字段校验失败、服务层普通异常、文件夹业务/文件错误 |
| `403` | Host/Origin 守卫、文件夹越界 |
| `404` | 路由未匹配、文件夹不存在、缩略图无封面 |
| `409` | 样本处理不可用、扫描已运行、文件夹 cursor 过期 |
| `416` | Range 非法 |
| `500` | 未捕获异常（Hono 默认纯文本）或端点自行返回 JSON |
| `502` | 图片代理拉取失败 |

### 3.2 业务错误码

`ErrorCode` 主要用于播放加载错误、WS `error` 事件、播放失败事件与下载失败。完整表见第 13 节。

## 4. 版本与能力协商

### 4.1 `GET /api/info`

返回 `CoreInfo`：

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

字段来源：

- `version`：`ATOM_APP_VERSION` → `runtime.json.atomVersion` → 默认 `1.0.0`。
- `commit`：`ATOM_COMMIT` → `runtime.json.atomCommit` → `unknown`。
- `sourceDirty`：`ATOM_SOURCE_DIRTY==="1"`，否则 `runtime.json.sourceDirty`。
- `direttaSdkRelease`：仅当 native 构建带 Diretta 时非 null。
- `protocol.version`：常量 `1`。

### 4.2 能力位

| 位 | 实际值 | 说明 |
| --- | --- | --- |
| `library` | 恒 `true` | 本地曲库 |
| `playback` | 恒 `true` | 播放链路 |
| `download` | 恒 `true` | 下载域 |
| `diretta` | 由 native 构建决定 | 是否编译 Diretta SDK |
| `netease`/`qqmusic`/`kugou`/`qobuz`/`tidal` | 恒 `true` | 静态支持，不代表已登录 |
| `remoteOutput` | **恒 `false`** | 尽管 UPnP 已实现 |

重要：

- 服务端**不按 capability 拒绝任何路由**。例如 `remoteOutput:false` 时 `/api/output/devices` 仍返回 UPnP 设备。
- capability 只用于 UI 隐藏/提示；登录态看 `/api/providers/sessions`。

## 5. 公共数据结构

### 5.1 Track

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 平台 ID；本地为路径 SHA-256 前 16 位 |
| `extId` / `mediaId` | string? | 平台二级/媒体 ID |
| `source` | `"local" \| "streaming" \| "netease" \| "qqmusic" \| "kugou" \| "qobuz" \| "tidal"` | 来源 |
| `path` / `cuePath` / `cueAudioPath` | string? | 本地路径、CUE、CUE 对应音频 |
| `cueStartMs` / `cueEndMs` | number? | CUE 区间毫秒 |
| `cueStartFrame75` / `cueEndFrame75` | number? | CUE 75fps 整数帧 |
| `serverId` / `originalId` | string? | 仅 `streaming` |
| `title` | string | 标题 |
| `comment` | string? | 注释/副标题 |
| `artists` | `Artist[]` | `{id?,name,avatar?,albumCount?}` |
| `album` | `Album?` | `{id?,name,cover?,artist?,trackCount?,year?}` |
| `track` / `disc` | number? | 曲目/碟号 |
| `duration` | number | **毫秒** |
| `cover` / `coverOriginal` | string? | `cache://`、`streaming-cover://` 或远端 URL |
| `fileSize` | number? | 字节 |
| `mtime` / `ctime` | number? | Unix 毫秒 |
| `quality` | `AudioQuality?` | `{sampleRate Hz, channels, bitsPerSample, bitRate bps, codec}` |
| `fee` | `0 \| 1 \| 4 \| 8`? | 网易云付费标记 |
| `cloud` | boolean? | 云盘歌曲 |

`LoadOptions` / `LoadResult`（仅遗留 `/api/player/load` 使用）：

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

### 5.2 队列与会话

`PlaybackQueueItem`：

```ts
{ track: Track, context?: PlaybackContext }
```

`PlaybackContext`：

```ts
{
  provider?: TrackSource;
  originId: string;
  originType: "track" | "playlist" | "album" | "artist" | "radio" | "rank" | "page";
  originName?: string;
}
```

`PlaybackSessionSnapshot`：

```ts
{
  active: boolean;
  mode: "queue" | "personalFm";
  personalFmOptions?: PersonalFmOptions;
  queue: PlaybackQueueItem[];
  originalQueue: PlaybackQueueItem[] | null;
  index: number;                 // 空队列为 -1
  current: Track | null;
  repeat: "off" | "list" | "one";
  shuffle: "off" | "on";
  autoClose?: {
    enabled: boolean;
    duration: number;            // 分钟
    endTime: number;             // epoch ms
    waitSongEnd: boolean;
    pendingStopOnEnd: boolean;
  };
}
```

类型上 `autoClose` 可选；当前实现始终返回。

### 5.3 PlayerStatus

```ts
{
  state: "idle" | "loading" | "playing" | "paused" | "stopped";
  position: number;   // 毫秒，已按 CUE 显示区间投影
  duration: number;   // 毫秒
  volume: number;     // 0..1，实际生效值
  speed: number;      // 倍率
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

设备 ID：

- ALSA：`alsa:hw:CARD=<id>,DEV=<n>`
- Diretta：`diretta:<selector>`（现场可见 `diretta:fe80::...,19644` 形式）
- UPnP：`upnp:<udn>`，如 `upnp:uuid:...`

### 5.5 下载

`DownloadRequest`：

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

`DownloadTask`：

```ts
{
  taskId: string;
  status: "queued" | "downloading" | "done" | "failed" | "canceled" | "interrupted";
  track: Track;
  qualityLevel: string;
  received: number;  // 字节
  total: number;     // 字节
  filePath?: string;
  errorCode?: string;
  tagWarning?: boolean;
  createdAt: number; // epoch ms
  finishedAt?: number;
}
```

`EnqueueResult`：`{ ok: boolean, reason?: "queued" | "downloaded" }`。

### 5.6 插件

`PluginInfo`：

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

### 5.7 流媒体

`StreamingServerConfig`：

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

`StreamingConfigSnapshot`：

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

### 5.8 统计

`PlayStatsSummary`：

```ts
{
  todayListenedMs: number; weekListenedMs: number; lastWeekListenedMs: number;
  totalListenedMs: number; weekPlayCount: number; totalPlayCount: number;
  weekFavoriteAdds: number; streakDays: number;
}
```

`LibraryStats`：`{ trackCount, albumCount, artistCount, totalDurationMs, totalFileSize, codecs: {codec,count}[] }`。

`TopTrack`：`{ track: Track, playCount: number }`；`TopAlbum` 同构；`TopArtist`：`{ artist, track, playCount }`。

### 5.9 缓存与设置

`CacheStat`：`{ id: CacheCategory, kind: "file" | "db", path: string, size: number }`。

`CoreSettingsSnapshot` 顶层：

```ts
{
  player, library, lyric, localLyric, cache, download, streaming, listenbrainz,
  system: { neteaseRealIp, networkProxy, neteaseScrobbleEnabled, neteaseScrobbleMode }
}
```

### 5.10 文件夹

`FolderBrowsePage`：

```ts
{
  path: string; root: string; parent: string | null; unavailable: boolean;
  associations?: { album?: Album; artist?: Artist };
  counts: { directories: number; media: number; materials: number; total: number };
  entries: FolderBrowseEntry[];
  previousCursor?: string; nextCursor?: string;
}
```

`FolderBrowseEntry` 联合：`directory` / `track` / `file` / `cue` / `sacd` / `material`。

## 6. HTTP 端点参考

> 通用：Headless 校验/命令异常通常 `400 {error}`；样本处理门禁 `409 {error:"output_processing_unavailable"}`；未捕获异常为 Hono 默认 `500 text/plain`。下表只列关键差异。

### 6.1 系统、设置、文件系统、信息

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/info` | — | `CoreInfo` | 版本/能力协商 |
| `GET /api/status` | — | `PlayerStatus` | 位置/音量/输出能力 |
| `GET /api/settings/core` | — | `CoreSettingsSnapshot` | Core 设置快照 |
| `POST /api/settings/core` | `{keyPath*, value?}` | `{ok:true}` | 路径白名单；见下 |
| `GET /api/filesystem/directories?path=` | `path?` | `CoreDirectoryListing` | 目录选择器；可列主机目录 |
| `POST /api/system/network-proxy/test` | — | `{ok:boolean}` | 测试代理 |
| `GET /api/proxy/image?url=` | `url*` | 图片字节 | 仅 TIDAL/Qobuz 图片域；5 MiB；400/502 |

`POST /api/settings/core` 允许：

- 前缀：`player.`、`lyric.`、`localLyric.`、`cache.songCache.`、`download.`、`listenbrainz.`、`system.networkProxy.`。
- 精确：`streaming.enabled`、`system.neteaseRealIp`、`system.neteaseScrobbleEnabled`、`system.neteaseScrobbleMode`、`system.networkProxy`。
- 拒绝（走专用端点）：`player.outputDevice`、`player.volume`、`player.lyricOffsets`、`cache.dir`、`download.dir`。
- `library.*` 不能通过此端点修改。
- 不校验 value schema；未知子键只要前缀匹配也会写入。

### 6.2 曲库（Compat API）

#### 读取、搜索、随机

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/library/tracks` | — | `{data:Track[], total:number}` | 不含 CUE 容器整轨 |
| `GET /api/library/albums` | — | `{data:AlbumSummary[]}` | |
| `GET /api/library/artists` | — | `{data:ArtistSummary[]}` | |
| `GET /api/library/albums/:albumId/tracks?name=` | `name?` | `{data:Track[]}` | 同名专辑消歧 |
| `GET /api/library/artists/:artistName/tracks` | path | `{data:Track[]}` | |
| `GET /api/library/tracks/by-ids?ids=` | `ids?` 逗号分隔 | `{data:Track[]}` | 不保证顺序 |
| `GET /api/library/search?q=&type=&offset=&limit=` | `q?`；`type?` songs/albums/artists/playlists；`offset?`；`limit?` 0=全部，最大 500 | `{data,total}` | `playlists` 恒空 |
| `GET /api/library/random?limit=` | `limit?` 1..100，默认 1 | `{data:Track[]}` | |
| `GET /api/library/random-one` | — | `{data:Track\|null}` | |
| `GET /api/library/count` | — | `{data:number}` | |

#### 扫描目录与扫描控制

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/library/scan-dirs` | — | `{data:string[]}` | |
| `POST /api/library/scan-dirs` | `{dirs:string[]*}` | `{success:true,data:string[]}` | 只写配置，不验证目录 |
| `POST /api/library/scan-dirs/add` | `{dir*}` | `{success:true,data:string}` | realpath；409 已存在 |
| `DELETE /api/library/scan-dirs` | body `{dir*}` | `{success:true}` | 删 DB 记录，不删文件 |
| `GET /api/library/is-scanning` | — | `{data:boolean}` | |
| `GET /api/library/scan-progress` | — | `{data:ScanProgress}` | phase 实际只有 scanning/done |
| `POST /api/library/scan` | `{incremental?:boolean=true}` | `{success:true}` | 409 正在扫描 |
| `POST /api/library/scan/cancel` | — | `{success:true}` | |

#### 红心、标签、头像

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/library/liked` | — | `{data:string[]}` | |
| `POST /api/library/liked` | `{trackId*, liked:boolean*}` | `{success:true,data:string[]}` | 返回全部 ID |
| `POST /api/library/liked/import` | `{trackIds:string[]*}` | `{success:true,data:string[]}` | |
| `POST /api/library/tags/read` | `{path*}` | `{success:true,data:TrackTags}` | |
| `POST /api/library/tags/write` | `{edits:TagEditRequest[]*}` | `{success:true,data:TagWriteOutcome[]}` | 只写已知文件 |
| `GET /api/library/artists/:artistName/avatar` | path | `{success:true,data:string\|null}` | `cache://artists/...` |
| `POST /api/library/artists/avatars` | `{names:string[]*}` | `{success:true,data:Record<string,string>}` | |

`TagEditRequest` 字段：`path*`、`title?`、`artist?`、`album?`、`albumArtist?`、`year?`、`genre?`、`trackNumber?`、`discNumber?`、`lyrics?`、`coverPath?`、`coverUrl?`。`undefined` 不改；空串/0 清除。

### 6.3 文件夹（Folder Browser）

所有路径必须在 `library.scanDirs` 内，并做 `realpath` 复核。错误映射：

- `FOLDER_CURSOR_STALE` → 409
- 含 `OUTSIDE_LIBRARY_ROOT` → 403
- 含 `NOT_FOUND` → 404
- 其他 → 400

#### 浏览、容器、搜索、pin

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/library/folders/roots` | — | `{roots:FolderRootEntry[],pins:FolderPinEntry[]}` | |
| `GET /api/library/folders/browse` | `path*`；`cursor?`；`limit?` 默认 200，1..500；`focus?`；`filter?`；`sort?` name/mtime/track；`order?` asc/desc | `FolderBrowsePage` | 目录不可达返回 200 + `unavailable:true` |
| `GET /api/library/folders/container?path=` | `path*` | `FolderContainerResult` | CUE/SACD 展开 |
| `GET /api/library/folders/search` | `q?`；`cursor?`；`limit?` 默认 100，1..200；`path?` | `FolderSearchPage` | 最多遍历 100,000 项 |
| `GET /api/library/folders/pins` | — | `FolderPinEntry[]` | 裸数组 |
| `POST /api/library/folders/pins` | `{path*}` | `FolderPinEntry[]` | |
| `DELETE /api/library/folders/pins` | `{path*}` | `FolderPinEntry[]` | |

#### 扫描、定位、播放、批量

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `POST /api/library/folders/scan` | `{path*, incremental:boolean*}` | `{ok:true}` | 409 已扫描 |
| `POST /api/library/folders/location` | `{track:Track*}` | `FolderNavigationTarget` | |
| `POST /api/library/folders/play` | `{path*, recursive?:boolean=true}` | `FolderActionResult` | 替换队列并播放 |
| `POST /api/library/folders/shuffle` | 同上 | `FolderActionResult` | 随机起点 + shuffle on |
| `POST /api/library/folders/play-next` | 同上 | `FolderActionResult` | 插到当前之后 |
| `POST /api/library/folders/queue` | 同上 | `FolderActionResult` | 追加 |
| `POST /api/library/folders/batch/play` | `{targets:FolderBatchTarget[]*}` | `FolderActionResult` | 非递归 |
| `POST /api/library/folders/batch/play-next` | 同上 | `FolderActionResult` | |
| `POST /api/library/folders/batch/queue` | 同上 | `FolderActionResult` | |

`FolderBatchTarget`：

```ts
{ kind: "path", path: string }
| { kind: "container-track", containerPath: string, trackId: string }
```

`FolderActionResult`：`{ count: number, failed: string[] }`。

#### 加入歌单

| 方法/路径 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/library/folders/playlist` | `{playlistId*, path*, recursive?:boolean=true}` | `FolderPlaylistResult` |
| `POST /api/library/folders/playlist-track` | `{playlistId*, containerPath*, trackId*}` | `FolderPlaylistResult` |
| `POST /api/library/folders/batch/playlist` | `{playlistId*, targets[]*}` | `FolderPlaylistResult` |

`FolderPlaylistResult`：`{ count, failed, added }`。

#### 资料与流

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/library/folders/material/text?path=` | `path*` | `FolderTextMaterial` | 最多 1 MiB |
| `GET /api/library/folders/material/thumbnail?path=` | `path*` | JPEG 320px | 404/400 |
| `GET /api/library/folders/directory/thumbnail?path=` | `path*` | JPEG 320px 或空 404 | |
| `GET /api/library/folders/material?path=` | `path*`；可选 `Range` | 文件流 | 200/206/416 |

材料类型：图片（jpg/jpeg/png/webp/gif）、PDF、文本（txt/log/nfo/md）。会校验魔数；伪装文件被忽略或 400。

### 6.4 歌单

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/playlists` | — | `PlaylistSummary[]` | 裸数组 |
| `GET /api/playlists/:id` | path | `PlaylistDetail\|null` | 缺失返回 null |
| `POST /api/playlists` | `{type:"local"*, title*, description?}` | `PlaylistSummary` | 空 title → 500 |
| `PATCH /api/playlists/:id` | `{title?, description?, cover?}` | `PlaylistSummary\|null` | 空 title → 500 |
| `DELETE /api/playlists/:id` | path | `{ok:true}` | 不存在也成功 |
| `POST /api/playlists/:id/tracks` | `{trackIds:string[]*}` | `{count:number}` | 新曲插到最前 |
| `DELETE /api/playlists/:id/tracks` | `{trackIds:string[]*}` | `{count:number}` | |
| `POST /api/playlists/import-legacy` | `LegacyPlaylistRecord[]` | `{ok:true}` | `INSERT OR IGNORE` |
| `DELETE /api/playlists` | — | `{ok:true}` | 清空 |

### 6.5 播放会话

成功响应除特别说明外均为 `Snapshot`。

| 方法/路径 | 请求 | 备注 |
| --- | --- | --- |
| `GET /api/session` | — | 权威会话快照 |
| `POST /api/session/migrate-legacy` | `{items*, originalItems*, index*, repeat*, shuffle*}` | 已有队列时静默返回当前 |
| `POST /api/session/reload` | `{forcePlay?:boolean}` | `{reloaded:boolean}`；失败 200 |
| `POST /api/session/queue` | `{items*, startIndex?=0, autoPlay?=true, loadCurrent?=true}` | 替换队列 |
| `POST /api/session/play-track` | `{track*, autoPlay?=true}` | 单曲 |
| `POST /api/session/queue/append` | `{items*}` | 追加 |
| `POST /api/session/queue/insert` | `{items*, index*}` | 插入 |
| `POST /api/session/queue/move` | `{fromIndex*, toIndex*}` | 越界不变 |
| `PATCH /api/session/queue/:index` | `{item*}` | 替换单项 |
| `PATCH /api/session/queue/tracks` | `{tracks:Track[]*}` | **当前被 `/:index` 遮蔽，不可达** |
| `DELETE /api/session/server/:serverId` | path | 移除该服务器曲目 |
| `POST /api/session/queue/select` | `{index*, loadCurrent?=true, autoPlay?=true}` | 选择并加载 |
| `DELETE /api/session/queue/:index?loadCurrent=` | path；`loadCurrent` 仅 `"0"` 为 false | 移除单项 |
| `DELETE /api/session/queue` | — | 清空并停止 |
| `POST /api/session/queue/clear` | `{stop?:boolean=false}` | 默认只清队列，不停止 |
| `POST /api/session/next` | `{loadCurrent?=true}` | 下一首 |
| `POST /api/session/prev` | `{loadCurrent?=true}` | 上一首；首曲环绕到队尾 |
| `POST /api/session/repeat` | `{mode: off/list/one*}` | |
| `POST /api/session/shuffle` | `{mode: off/on*}` | |
| `POST /api/session/personal-fm` | `{options?, autoPlay?=true}` | 无结果广播 `NETEASE_UNAVAILABLE` |
| `POST /api/session/personal-fm/dislike` | `{playedSec?}` | 秒 |
| `POST /api/session/auto-close` | `{durationMin*, waitSongEnd?=false}` | 最小 1 分钟 |
| `DELETE /api/session/auto-close` | — | 取消 |

会话语义注意：

- `autoPlay`/`loadCurrent` 只有严格 `false` 才关闭；字符串 `"false"` 视为 true。
- `DELETE /session/queue` 会停止输出；`POST /session/queue/clear` 默认不停止。
- `stop()` 不清空队列，`active` 仍可能为 true。
- `clearQueue` 只清 NowPlaying 的 track/detail，不重置 position/state。
- Personal FM 不检查网易登录；池为空时返回空队列并广播错误。

### 6.6 播放器控制

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `POST /api/play` | — | `{ok:true}` | 加载失败 400 |
| `POST /api/pause` | — | `{ok:true}` | 不抛错 |
| `POST /api/stop` | — | `{ok:true}` | 不清队列 |
| `POST /api/seek` | `{positionMs*>=0}` | `{ok:true}` | 毫秒 |
| `POST /api/next` | — | `{ok:true}` | 加载失败 400 |
| `POST /api/prev` | — | `{ok:true}` | |
| `GET /api/volume` | — | `{volume:number}` | Direct/UPnP 为 1 |
| `POST /api/volume` | `{volume* 0..1}` | `{ok:true}` | 409 样本处理不可用；写 settings |
| `POST /api/player/load` | `{source*, options?:LoadOptions}` | `LoadResult` | **遗留低层接口**；绕过 session/解析，正常 Control 不要使用 |
| `POST /api/player/reinit` | — | `{success:true}` | UPnP/无活动时无操作 |
| `POST /api/player/speed` | `{speed*}` | `{ok:true}` | native clamp 0.5..2.0 |
| `POST /api/player/pitch` | `{semitones?=0}` | `{ok:true}` | native clamp -12..12 |
| `POST /api/player/pitch-sync` | `{enabled?}` | `{ok:true}` | 仅严格 true |
| `POST /api/player/normalization` | `{enabled?}` | `{ok:true}` | 仅严格 true |
| `POST /api/player/equalizer` | `{enabled?, bands?, preamp?}` | `{ok:true}` | bands 10 段，-15..15；preamp -12..12 |
| `POST /api/player/fade` | `{durationMs?=0}` | `{ok:true}` | 负数置 0 |
| `GET /api/player/fade` | — | `{data:number}` | 毫秒 |
| `GET /api/player/cover` | — | `{data:string\|null}` | data URL；MIME 固定 JPEG |
| `POST /api/player/read-lyric` | `{path*}` | `{data:string}` | 扩展名白名单；可读任意路径 |
| `GET /api/player/alsa-mode` | — | `{mode:"direct"\|"processed"}` | |
| `POST /api/player/alsa-mode` | `{mode*}` | `{ok:true,mode}` | 切换事务 |

样本处理门禁只作用于 `/volume`、`speed`、`pitch`、`pitch-sync`、`normalization`、`equalizer`、`fade`。这些 `/player/*` 命令只改运行时 native 状态，不写 Settings（`/volume` 例外）。

### 6.7 Now Playing 与歌词

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/now-playing` | — | `NowPlayingSnapshot` | 包含 track/detail/position/playing/state/speed/sendTimestamp |
| `POST /api/now-playing/lyric-offset/query` | `{trackId*, source?}` | `{offsetMs:number}` | 缺省 0 |
| `POST /api/now-playing/lyric-offset` | `{trackId*, source?, offsetMs?=0}` | `{ok:true}` | clamp ±60,000；0 删除 |
| `POST /api/lyrics/match-by-id` | `{platform*, id*}` | `LyricMatchResponse` | 不支持平台 200 `{ok:false}` |
| `POST /api/lyrics/match-by-query` | `{platform*, track*}` | `LyricMatchResponse` | |
| `POST /api/lyrics/ttml-overlay` | `{platform:"netease"\|"qqmusic"*, track*}` | `LyricTTMLResponse` | |
| `POST /api/lyrics/local` | `{track*}` | `LyricTTMLResponse` | 本地 TTML 库 |

`NowPlayingSnapshot`：

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

歌词偏移 key：`trackId` + `|` + 歌词源；正值为歌词提前。

### 6.8 输出设备

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/output/devices` | — | `{selected, alsaPlaybackMode, data:AudioDevice[]}` | 顺序 ALSA + Diretta + UPnP；Diretta 扫描失败会整体 500 |
| `POST /api/output/select` | `{deviceId: string\|null}` 必须含键 | `{ok:true, selected}` | Diretta 需 root；UPnP 需 `upnp:` 前缀；失败 500 |
| `GET /api/output/scan` | — | `{success:true,data:AudioDevice[]}` | 仅本地 native 列表，不含 Diretta/UPnP |

`deviceChanged` 事件数据恒为 `{defaultDevice:null}`。

### 6.9 缓存

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/cache/stats` | — | `CacheStat[]` | covers/artists/backgrounds/songs/lyric/lyricTTML/lyricMatch |
| `GET /api/cache/dir` | — | `{dir}` | |
| `POST /api/cache/dir` | `{dir*}` | `CacheSwitchResult` | 目标必须存在且为空；非空 200 `{ok:false,reason:"notEmpty"}` |
| `POST /api/cache/clear` | `{id:CacheCategory*}` | `{ok:true}` | |
| `POST /api/cache/clear-all` | `{kind:"file"\|"db"*}` | `{ok:true}` | |
| `POST /api/cache/reset-dir` | — | `{dir}` | 清文件缓存，恢复默认 |

`CacheStat.path` 对 DB 类是表名，不是路径。DB 大小只统计指定字段 `length()`，不含索引/页开销。

### 6.10 下载

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/download/tasks` | — | `DownloadTask[]` | 最新在前 |
| `GET /api/download/dir` | — | `{dir}` | |
| `POST /api/download/dir` | `{dir*}` | `{dir}` | realpath |
| `POST /api/download/reset-dir` | — | `{dir}` | |
| `POST /api/download/start` | `DownloadRequest` | `EnqueueResult` | 400 `download_request_invalid` |
| `POST /api/download/start-many` | `DownloadRequest[]` | `EnqueueResult[]` | 可空数组 |
| `POST /api/download/cancel` | `{taskId*}` | `{ok:true}` | 未知 ID 也成功 |
| `POST /api/download/remove` | `{taskId*}` | `{ok:true}` | 不删已完成文件 |
| `POST /api/download/clear-finished` | — | `{ok:true}` | |

去重键：`track.source:track.id:qualityLevel`；同键在队列或已下载返回 `{ok:false,reason:"queued"|"downloaded"}`（HTTP 200）。下载串行；失败 `errorCode` 目前统一 `UNKNOWN`。

### 6.11 插件

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/plugins` | — | `PluginInfo[]` | |
| `POST /api/plugins/install-url` | `{url*}` | `{ok,id?,error?}` | 仅 HTTPS/loopback HTTP；≤9MB |
| `POST /api/plugins/:id/uninstall` | path | `{ok,error?}` | 失败也 200 |
| `POST /api/plugins/:id/enabled` | `{enabled:boolean*}` | `{ok:true}` | |
| `POST /api/plugins/:id/setting` | `{key*, value?}` | `{ok:true}` | |
| `POST /api/plugins/:id/check-update` | path | `{ok,hasUpdate,plugin?,error?}` | |
| `POST /api/plugins/:id/apply-update` | path | `{ok,plugin?,error?,fallbackUrl?}` | 无 updateUrl → `PLUGIN_NO_UPDATE_URL` |
| `POST /api/plugins/resolve-url` | `PluginResolveUrlArgs` | `MusicUrlRes` | |
| `POST /api/plugins/invoke-menu` | `PluginInvokeMenuArgs` | `PluginInvokeMenuResult` | |
| `POST /api/plugins/match-lyric` | `PluginMatchLyricArgs` | `PluginMatchLyricResult` | |
| `POST /api/plugins/match-cover` | `PluginMatchCoverArgs` | `PluginMatchCoverResult` | |

插件状态变化通过 WS `pluginStatus` 推送。插件运行在独立 host 子进程，权限由 `@grant` 控制。

### 6.12 流媒体服务器

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/streaming/config` | — | `StreamingConfigSnapshot` | 不含密码 |
| `POST /api/streaming/server` | `StreamingServerInput*` | `StreamingServerConfig` | 缺字段可能 500 |
| `PATCH /api/streaming/server/:serverId` | `StreamingServerInput*` | `StreamingServerConfig` | |
| `DELETE /api/streaming/server/:serverId` | path | `{ok:true}` | 级联删快照 |
| `POST /api/streaming/active` | `{serverId?:string\|null}` | `StreamingConfigSnapshot` | 连接失败也 200，active 已写入 |
| `POST /api/streaming/test` | `{input*, serverId?}` | `StreamingPingResult` | 失败也 200 |
| `POST /api/streaming/connect` | `{serverId*}` | `StreamingConnectResult` | 失败也 200 |
| `POST /api/streaming/disconnect` | `{serverId*}` | `{ok:true}` | |
| `GET /api/streaming/snapshot?serverId=` | `serverId*` | `StreamingLibrarySnapshot` | 未知 ID 空数组 |
| `POST /api/streaming/sync` | `{serverId*, force?=false}` | `{started:boolean}` | 已运行/已同步返回 false |
| `GET /api/streaming/search?serverId=&query=` | `serverId*`；`query?` | `StreamingSearchResult` | query 截断 200 字符 |
| `GET /api/streaming/album-songs?serverId=&albumId=` | 均必填 | `Track[]` | |
| `GET /api/streaming/playlist-songs?serverId=&playlistId=` | 均必填 | `Track[]` | |
| `GET /api/streaming/artist-albums?serverId=&artistId=` | 均必填 | `Album[]` | |
| `GET /api/streaming/artist-songs?serverId=&artistId=` | 均必填 | `Track[]` | |
| `POST /api/streaming/lyrics` | `{serverId*, trackId*, hint?}` | `{lyric:string\|null}` | |
| `GET /api/streaming/cover?serverId=&coverId=&size=` | `serverId*`,`coverId*`；`size?` 默认 300，32..2000 | 图片字节 | 缺参 400 空 body；无图 204；Content-Type 固定 octet-stream |

### 6.13 在线平台

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `POST /api/providers/call` | `{platform*, name*, params?}` | `ApiCallResponse` | 上游失败仍 200 `{ok:false}` |
| `GET /api/providers/sessions` | — | `ProviderSessionsSnapshot` | 不含凭据 |
| `POST /api/providers/clear-session` | `{platform*}` | `{ok:true}` | Qobuz/TIDAL 网络失败可能 500 |
| `POST /api/providers/set-cookie` | `{platform*, cookie*}` | `{ok}` | 仅 NCM/QM/KG |

`platform` 必须是 `netease|qqmusic|kugou|qobuz|tidal`。`name` 是平台方法名，路由不枚举。

Session 判定：

- 网易云：存在 `MUSIC_U`。
- QQ：`uin` 非空且非 `"0"`，且有登录 key。
- 酷狗：`token` + `userid`。
- Qobuz/TIDAL：各自 auth 状态。

### 6.14 评论

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/comments/sources` | — | `CommentSource[]` | 内置 NCM/QM/KG + 插件源 |
| `POST /api/comments/music` | `MusicCommentQuery` | `{ok:true,data:MusicCommentPage}` | 上游错误仍 200 `{ok:false}` |

`MusicCommentQuery`：`{sourceId*, track*, type:"hot"|"new"*, page?, limit?, cursor?}`。`limit` 默认 20，最大 50。酷狗只支持 hot；`new` 返回空。

### 6.15 统计

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/stats/summary` | — | `PlayStatsSummary` | 读库失败返回全 0 |
| `GET /api/stats/library` | — | `LibraryStats` | |
| `GET /api/stats/top-tracks?limit=` | `limit?` 1..100 | `TopTrack[]` | 排除 streaming |
| `GET /api/stats/daily?days=` | `days?` 1..365，默认 30 | `DailyPlayStats[]` | 只返回有记录日期 |
| `GET /api/stats/hourly` | — | `HourlyPlayStats[]` | 固定 24 项 |
| `GET /api/stats/top-albums?limit=` | `limit?` | `TopAlbum[]` | 排除 streaming |
| `GET /api/stats/top-artists?limit=` | `limit?` | `TopArtist[]` | 排除 streaming |
| `POST /api/stats/favorite` | `{track*, action:"add"\|"remove"*}` | `{ok:true}` | 服务端用当前时间 |

周起点为本地时区周一 00:00；daily/hourly 为本地时区。

### 6.16 ListenBrainz

| 方法/路径 | 请求 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| `GET /api/listenbrainz/status` | — | `ListenBrainzStatus` | 不含 token |
| `PUT /api/listenbrainz/link` | `{token*}` | `ListenBrainzStatus` | 需已启用；15s 校验 |
| `DELETE /api/listenbrainz/link` | — | `ListenBrainzStatus` | |
| `POST /api/listenbrainz/outbox/clear` | — | `ListenBrainzStatus` | 未启用/无 child 400 |

`ListenBrainzStatus`：`{enabled,sendNowPlaying,linked,account,state,pending,dead,lastError,processActive}`。

### 6.17 静态资源、图片与缓存文件

| 路径 | 行为 |
| --- | --- |
| `GET /` | `renderer/index.html`，`no-store` |
| `GET /debug` | 同样返回 index.html；前端挂 debug 应用 |
| `GET /*` | `serveStatic(renderer)`；无 SPA history fallback |
| `GET /cache/covers/*` | 封面缓存；缺失时尝试修复 |
| `GET /cache/artists/*` | 歌手图缓存 |
| `GET /cache/backgrounds/*` | 背景缓存 |

前端使用 hash 路由，深链接形如 `/#/songs`，不需要服务端 fallback。

图片端点：

| 端点 | 限制 | 缓存头 |
| --- | --- | --- |
| `GET /api/proxy/image` | 仅 TIDAL/Qobuz 图域；5 MiB；10s；禁重定向 | `public, max-age=86400` |
| `GET /api/streaming/cover` | 5 MiB；15s；size 32..2000 | `private, max-age=300` |
| `GET /api/library/folders/material/thumbnail` | 320px JPEG | `private, max-age=300` |
| `GET /api/library/folders/directory/thumbnail` | 320px JPEG；无图 404 | `private, max-age=300` |
| `GET /api/library/folders/material` | 原文件流；Range | `private, max-age=300` |
| `GET /api/player/cover` | base64 data URL；MIME 固定 JPEG | 无 |

## 7. WebSocket 契约

### 7.1 连接

```text
ws://<core-host>:14558/ws
wss://<core-host>/ws        # 反向代理 TLS
```

- 无鉴权、无查询 token、无子协议协商。
- 升级请求同样经过 Host/Origin 守卫。
- 无应用层 ping/pong；`ws` 默认 `maxPayload=100 MiB`。
- 服务停止时 close code `1001`，reason `Core server stopping`，1 秒后 terminate。

### 7.2 消息格式

Server → Client：

```json
{ "kind": "hello", "clients": 3 }
{ "kind": "event", "type": "status", "data": { } }
{ "kind": "ack", "op": "play" }
{ "kind": "error", "op": "seek", "error": "positionMs (number, >=0) required" }
```

Client → Server：

```json
{ "op": "play" | "pause" | "stop" | "next" | "prev" | "seek" | "setVolume", ... }
```

### 7.3 客户端命令

| op | 参数 | 校验 | 行为 |
| --- | --- | --- | --- |
| `play` | — | 无 | `play()`；立即 ack；失败不 error |
| `pause` | — | 无 | `pause()`；立即 ack |
| `stop` | — | 无 | `stop()`；立即 ack |
| `next` | — | 无 | `next()`；立即 ack；失败不 error |
| `prev` | — | 无 | `prev()`；立即 ack |
| `seek` | `positionMs:number` | finite 且 `>=0` | 等待成功后 ack/error |
| `setVolume` | `volume:number` | finite 且 0..1 | 样本处理不可用会 error；**不写 Settings** |
| 未知 | — | — | `{kind:"error",op:...,error:"unknown op"}` |
| 非法 JSON | — | — | `{kind:"error",op:"?",error:"invalid json"}` |

边界：

- `Number(null) === 0`，`seek`/`setVolume` 传 null 会被当 0 接受。
- 数字字符串也会被接受。
- `play/pause/stop/next/prev` 的 ack 不代表播放成功；真正失败通过后续 `status`/`error`/`session` 事件体现。
- 顶层 JSON 为 `null` 时可能不返回 error 帧（代码缺陷）。

### 7.4 服务端事件

| type | data | 触发 |
| --- | --- | --- |
| `status` | `PlayerStatus` | 原生 stateChanged、加载中、UPnP 观测 |
| `trackLoaded` | `{track, context?, source, autoPlay, detail?, mediaInfo?}` | 会话 load / gapless boundary |
| `position` | `{position,duration}` | **被 WS 过滤，外部收不到** |
| `error` | `{error:string}` | 加载失败 |
| `deviceChanged` | `{defaultDevice:null}` | 输出切换成功 |
| `session` | `PlaybackSessionSnapshot` | 任何 session publish |
| `providerSessions` | `ProviderSessionsSnapshot` | 登录态变化 |
| `libraryScanProgress` | `ScanProgress` | 扫描开始/进度/结束/取消 |
| `libraryChanged` | `{revision:number}` | 曲库内容变化 |
| `libraryLikesChanged` | `{ids:string[]}` | 红心变化 |
| `libraryRootsChanged` | `{paths:string[]}` | 扫描目录变化 |
| `folderPinsChanged` | `{paths:string[]}` | 固定目录变化 |
| `downloadState` | `DownloadTask` | 任务状态变化 |
| `downloadProgress` | `{taskId,received,total}` | 250ms 节流 |
| `streamingConfigUpdated` | `StreamingConfigSnapshot` | 服务器增删改/激活/连接 |
| `streamingLibraryUpdated` | `{serverId}` | 流媒体库同步 |
| `lyricOffset` | `{trackId,source,offsetMs}` | 歌词偏移变化 |
| `pluginStatus` | `PluginInfo` | 插件状态变化 |
| `ended` | `{consumedBySession:boolean}` | 原生结束 |
| `directTrackBoundary` | `{duration,generation}` | Direct 边界未被消费时 |
| `processedTrackBoundary` | `{duration,generation}` | Processed 边界未被消费时 |
| `sourceError` | `{consumedBySession:boolean}` | 原生源错误 |

不发送：

- `seek`、`play`、`pause`、`next`、`prev`、`playTrack`、`setShuffle`、`setRepeat`、`addToQueue`、`toggleLike` 等命令型 `PlayerEvent` 类型不广播。
- `position` 被 `HIGH_FREQ_EVENTS` 明确过滤。

投递特性：

- 无订阅过滤、无事件序号、无重放；断线期间事件丢失。
- `hello` 与后续事件没有严格顺序保证。
- 客户端集合是进程内 `Set`；发送失败的客户端会被移除。
- `clients` 只在连接时告知，之后在线数变化不会广播。

## 8. 单位与范围

| 字段 | 单位/范围 |
| --- | --- |
| `Track.duration` | 毫秒 |
| `Track.cueStartMs`/`cueEndMs` | 毫秒 |
| `Track.cueStartFrame75`/`cueEndFrame75` | 75fps 帧 |
| `Track.fileSize` | 字节 |
| `Track.mtime`/`ctime` | Unix 毫秒 |
| `Track.quality.sampleRate` | Hz |
| `Track.quality.bitRate` | bps |
| `PlayerStatus.position`/`duration` | 毫秒（CUE 投影后） |
| `PlayerStatus.volume` | 0..1 |
| `PlayerStatus.speed` | 倍率，native clamp 0.5..2.0 |
| `seek.positionMs` | 毫秒 |
| `pitch.semitones` | 半音，native clamp -12..12 |
| `equalizer.bands` | 10 个 dB，-15..15 |
| `equalizer.preamp` | dB，-12..12 |
| `fade.durationMs` | 毫秒 |
| `autoClose.durationMin` | 分钟，最小 1 |
| `autoClose.endTime` | epoch 毫秒 |
| `NowPlaying.position` | 毫秒 |
| `NowPlaying.sendTimestamp` | epoch 毫秒 |
| `lyricOffset.offsetMs` | 毫秒，±60,000；正值为提前 |
| `DownloadTask.received`/`total` | 字节 |
| `DownloadTask.createdAt`/`finishedAt` | epoch 毫秒 |
| `CacheStat.size` | 字节 |
| `PlayStatsSummary.*Ms` | 毫秒 |
| `LibraryStats.totalFileSize` | 字节 |
| `DailyPlayStats.day` | 本地时区 `YYYY-MM-DD` |
| `HourlyPlayStats.hour` | 本地时区 0..23 |
| `ScanProgress.total`/`scanned` | 文件数 |
| `FolderBrowseEntry.mtime` | Unix 毫秒 |
| `FolderBrowseEntry.size` | 字节 |
| `ListenBrainzTrackSnapshot.listenedAt` | Unix 秒 |
| `ListenBrainzTrackSnapshot.durationMs` | 毫秒 |

Native 内部位置/时长/seek 使用**秒**；Core 在边界转换为毫秒。

## 9. 客户端实现建议

### 9.1 握手顺序

```text
GET /api/info
→ 校验 protocol.version ∈ [1,1]
→ 连接 /ws
→ 并行 GET /api/session、GET /api/status
→ 用 session/status 初始化 UI
→ 订阅 WS 事件
→ 每 500ms GET /api/status（页面可见时）
```

### 9.2 状态原则

- `/api/session` 是队列/索引/模式的权威快照。
- `/api/status` 是位置/状态/输出能力的权威快照。
- WS `session` 事件到达时整体替换本地队列，不要做增量猜测。
- WS `trackLoaded` 到达时更新当前曲目；若漏掉，可用 `/api/now-playing` 校验。
- WS 不推 `position`；必须轮询 `/api/status`。

### 9.3 重连

- 网络错误：1 秒后重连。
- 协议不兼容：停止重连，提示升级。
- 重连后重新拉 `/api/session` 与 `/api/status`；不要假设断线期间事件已补齐。

### 9.4 资源 URL

- `cache://covers/a.jpg` → `<origin>/cache/covers/a.jpg`
- `streaming-cover://image?serverId=...&coverId=...&size=...` → `<origin>/api/streaming/cover?...`
- 提交 Track 回 Core 时使用 canonical `cache://` / `streaming-cover://`，不要提交展示用 HTTP URL。

### 9.5 命令确认

- 播放/暂停/下一首/上一首的 WS ack 只表示命令已分派，不表示加载成功。
- 以 `status`/`session`/`trackLoaded`/`error` 事件判断最终结果。
- HTTP 播放命令失败会返回 400；不要只看 ack。

### 9.6 错误处理

- `OUTPUT_DEVICE_REQUIRED`：弹出输出选择器。
- `OUTPUT_FORMAT_UNSUPPORTED`：提示当前输出不支持该格式，不要自动降级。
- `NETEASE_*`/`PROVIDER_*`：按权益/登录/不可用分类提示。
- `LOAD_SUPERSEDED`：静默忽略（快速切歌的正常竞态）。

## 10. 兼容性与已知问题

| 问题 | 影响 | 规避 |
| --- | --- | --- |
| `PATCH /api/session/queue/tracks` 被 `/:index` 遮蔽 | 该端点不可达，返回 `valid index and item required` | 用逐项 `PATCH /api/session/queue/:index` 或替换整个队列 |
| `capabilities.remoteOutput` 恒 false | 不能据此判断 UPnP 可用 | 直接调 `/api/output/devices` |
| 服务端不按 capability 拒绝路由 | capability 不是安全/行为开关 | 仅用于 UI 提示 |
| WS 不推 `position` | 依赖位置的应用会静止 | 轮询 `/api/status` |
| `deviceChanged.data` 恒 `{defaultDevice:null}` | 无法从事件拿到新设备 | 重新拉 `/api/output/devices` |
| `stop()` 不清队列 | `/api/status` 可能仍 active | 需要清空时调 `DELETE /api/session/queue` |
| `prev()` 首曲环绕 | 与 repeat=off 不一致 | 客户端自行判断边界 |
| `POST /session/queue/clear` 默认不停止 | 音频可能继续 | 需要停止时传 `{stop:true}` |
| `personal-fm` 不检查登录 | 未登录时返回空队列 + 错误事件 | 客户端先检查平台会话 |
| `GET /api/streaming/cover` 缺参 400 空 body | 不能按 JSON 解析 | 按状态码处理 |
| `GET /api/player/cover` MIME 固定 JPEG | PNG/WebP 也被标成 JPEG | 浏览器通常能显示 |
| `/api/player/read-lyric` 可读任意路径 | 受信 LAN 暴露面 | 不要暴露公网 |
| `/api/library/scan-dirs` 不验证目录 | 可写入不存在/任意路径 | 客户端用目录选择器 |
| `/api/settings/core` 不校验 value schema | 未知子键也会持久化 | 客户端做类型/范围校验 |
| 无全局 body limit | 大请求可能占内存 | 反代限制 `client_max_body_size` |
| 无鉴权/无 TLS | 任何可达客户端可控制 | 网络隔离/反代认证 |
| `remoteOutput`/`diretta` 静态能力 | 不代表当前可用 | 以设备扫描/播放结果为准 |

## 11. 示例

### 11.1 查询信息

```bash
curl -s http://127.0.0.1:14558/api/info | jq
```

### 11.2 查询会话

```bash
curl -s http://127.0.0.1:14558/api/session | jq '.index, .current.title, .repeat, .shuffle'
```

### 11.3 播放单个曲目

```bash
curl -s -X POST http://127.0.0.1:14558/api/session/play-track \
  -H 'Content-Type: application/json' \
  -d '{"track":{"id":"...","source":"local","title":"...","artists":[],"duration":0},"autoPlay":true}'
```

### 11.4 设置音量

```bash
curl -s -X POST http://127.0.0.1:14558/api/volume \
  -H 'Content-Type: application/json' \
  -d '{"volume":0.5}'
```

### 11.5 选择输出

```bash
curl -s -X POST http://127.0.0.1:14558/api/output/select \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"alsa:hw:CARD=USB,DEV=0"}'
```

### 11.6 最小 WebSocket 客户端（Node）

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

### 11.7 轮询状态

```js
setInterval(async () => {
  const status = await (await fetch("http://127.0.0.1:14558/api/status")).json();
  console.log(status.state, status.position, status.output.path);
}, 500);
```

## 12. 端点索引

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

## 13. 错误码

`ErrorCode` 主要用于播放加载、WS 错误事件、播放失败与下载失败：

| code | 含义 |
| --- | --- |
| `DEVICE_NOT_FOUND` | 未找到输出设备 |
| `DEVICE_INIT_FAILED` | 设备初始化失败 |
| `OUTPUT_DEVICE_REQUIRED` | 尚未选择输出 |
| `FILE_NOT_FOUND` | 文件不存在/不可访问 |
| `FILE_NO_AUDIO_STREAM` | 无音频流 |
| `FILE_DECODE_ERROR` | 解码失败 |
| `FILE_NOT_SELECTED` | 用户取消选择 |
| `NETWORK_ERROR` | 音源连接失败 |
| `NETWORK_TIMEOUT` | 音源超时 |
| `URL_RESOLVE_FAILED` | 官方 + 插件都拿不到 URL |
| `NO_PLUGIN_AVAILABLE` | 无可用插件 |
| `NETEASE_LOGIN_EXPIRED` | 网易登录失效 |
| `NETEASE_VIP_REQUIRED` | 网易会员 |
| `NETEASE_PURCHASE_REQUIRED` | 网易购买 |
| `NETEASE_TRIAL_DISABLED` | 网易试听被禁用 |
| `NETEASE_UNAVAILABLE` | 网易无可用音源 |
| `PROVIDER_VIP_REQUIRED` | 其他平台会员 |
| `PROVIDER_PURCHASE_REQUIRED` | 其他平台购买 |
| `PROVIDER_TRIAL_DISABLED` | 其他平台试听被禁用 |
| `PROVIDER_UNAVAILABLE` | 其他平台无音源 |
| `PROVIDER_LOGIN_REQUIRED` | 需要登录 |
| `OUTPUT_FORMAT_UNSUPPORTED` | 输出不接受该格式 |
| `TAG_READ_FAILED` | 标签读取失败 |
| `TAG_WRITE_FAILED` | 标签写入失败 |
| `SCAN_NO_DIRS` | 未配置扫描目录 |
| `SCAN_DIR_EXISTS` | 目录已存在 |
| `SCAN_DIR_NOT_FOUND` | 目录不存在 |
| `SCAN_DIR_NOT_SELECTED` | 用户取消选择 |
| `LOAD_SUPERSEDED` | 加载被更新操作取代 |
| `MAX_CONSECUTIVE_FAILURES` | 连续失败达到上限 |
| `UNKNOWN` | 未知错误 |

## 14. 快速契约摘要

- 服务器：Hono + @hono/node-server + ws；`0.0.0.0:14558`；HTTP 与 WS 同端口。
- 所有 API 前缀 `/api`；除图片/流/错误纯文本/204/400 空 body 外均为 JSON。
- 无鉴权；Host/Origin 守卫不是身份认证。
- 生产无 CORS；开发 `ATOM_WEB_DEV_URL` 下 `/api/*` 为 `*`。
- 版本协商只看 `/api/info.protocol.version`，范围 `1..1`。
- capability 仅 UI 提示；`remoteOutput` 恒 false。
- 播放权威在 `/api/session`；位置轮询 `/api/status`。
- 播放/队列成功响应基本是完整 `Snapshot`。
- 时间毫秒、音量 0..1、速度倍率、自动关闭分钟。
- 图片 URL 用 `cache://` / `streaming-cover://`。
- 不要依赖 `PATCH /api/session/queue/tracks`（当前被遮蔽）。

## 15. 相关文档

- [项目书](./01-project.md)
- [开发手册](./02-development.md)
- [运维手册](./03-operations.md)
- [使用手册](./04-user-guide.md)
- [类型参考（既有）](../types.md)
- [插件开发](../plugins/)
- [Core 部署](../core-deployment.md)
