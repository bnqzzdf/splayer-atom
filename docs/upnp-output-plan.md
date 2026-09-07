# UPnP 源保真输出实施方案

日期：2026-09-07。

本文定义 Atom 的 UPnP 输出最终实施方案。UPnP 只是 Core 的一种额外输出方式，不改变
SPlayer 的基础播放器模型，也不建立第二套 queue、provider、cache、playback policy 或音频
engine。实现优先落在 Atom-owned 代码中；只有现有 seam 无法承载所需行为时，才对共享或
native 代码做最小修改。

SACD reader correctness 属于 `audio-engine-core` 自身维护，不属于 UPnP 实施范围。UPnP 仅
复用已经存在且独立验证的 CUE、PCM、SACD、DST、DSF/DFF 能力。

## 1. 目标与边界

- 单用户、可信 IPv4 LAN、单一 UPnP AV MediaRenderer。
- Core 保持 database、settings、canonical queue、provider session、source resolver、cache、
  preload/recovery、play statistics 和 output assignment 的唯一权威。
- UPnP 不拥有队列，不把队列交给 Renderer；自然结束后仍由 Core 的 repeat/shuffle/next
  policy 选择下一首。
- 优先传输原文件字节；只有 CUE、SACD ISO、DSD CUE 或设备容器兼容确实需要时，才生成
  样本/逻辑 DSD 序列保持的等价资源。
- 所有新增提取路径只支持双声道。未知声道布局、单声道、多声道以及没有 stereo area 的
  SACD ISO 明确失败，不 downmix。
- 不重采样、不 remix、不归一化、不应用 ReplayGain、EQ、fade、tempo、pitch、软件音量或
  DSD-to-PCM；DSD 不使用 DoP。
- Renderer 内部处理和 DAC bit-perfect 是独立硬件验收，不由“Core 发送了原文件”推导。
- 不做多房间、同步 Zones、OpenHome Playlist、通用 MediaServer/ContentDirectory、Desktop
  Output Agent、第二音频引擎或新的 provider 协议实现。

## 2. 实现原则

按 `AGENTS.md` 的最小下游规则执行：

1. 复用当前 SPlayer/Atom 已有类型、Core Control、queue、resolver、cache 和播放策略。
2. UPnP 特有协议与运行态尽量只存在于 `electron/main/atom/upnp/`。
3. 现有 native/local/Diretta 路径采用 early branch 包围式接入，不重写成通用 Output
   framework。
4. 只有第二个真实消费者出现时才抽取现有 helper；不为未来可能的实现预建 registry、adapter、
   capability graph 或状态机。
5. 新功能应主要在 UPnP 自有模块内部增长；增加 eventing、ConnectionManager、设备兼容等能力
   不应再次重构 Core playback architecture。

## 3. 稳定模块边界

新增：

```text
electron/main/atom/upnp/
  discovery.ts
  transport.ts
  output.ts
  media.ts
```

### `discovery.ts` — 找到 Renderer

负责有界 SSDP M-SEARCH、读取 device description、按 UDN 去重并解析 Renderer 的服务端点。
首版只要求拿到：

```text
UDN
friendlyName
LOCATION
AVTransport serviceType/controlURL
```

description 中已经存在的 `eventSubURL`、`SCPDURL`、ConnectionManager 信息可以低成本保留，
但首版不因此实现 eventing、SCPD capability engine 或 connection lifecycle。

首版不常驻 SSDP watcher，不维护 alive/byebye/max-age 状态机。刷新输出列表时扫描一个固定短
窗口；持久化的 `upnp:<UDN>` 播放前若没有当前 descriptor，可再扫描一次，找不到则报告设备
不可用。

### `transport.ts` — UPnP wire protocol

负责 XML/SOAP/DIDL-Lite 和当前确实使用的 AVTransport action：

```text
SetAVTransportURI
Play
Pause
Stop
Seek
GetTransportInfo
GetPositionInfo
```

内部只需要一个小型 `soapAction()` 共用请求逻辑。首版使用 AVTransport InstanceID 0。

以后真实设备需要 `SetNextAVTransportURI`、GENA eventing、ConnectionManager 或更多动作时，
优先只扩展本模块及 `output.ts`；复杂度真实增长后再拆文件，不预建通用 UPnP SDK。

### `output.ts` — Atom 的 UPnP 执行实例

这是 playbackSession 与 UPnP 的稳定 seam。它只负责当前 Renderer 的执行状态：

```text
scan/list/select
load
play/pause/stop/seek
status observation
current generation/resource
release
```

它不知道 provider、queue、repeat、shuffle、source recovery 或持久化业务。首版用
`GetTransportInfo` + `GetPositionInfo` 低频轮询状态，不实现 SUBSCRIBE/NOTIFY。

### `media.ts` — Renderer 可拉取的媒体资源

只管理当前/切换中的本地文件句柄并提供：

```text
GET
HEAD
single byte Range
206 / Content-Range
416
```

资源 ID 为不可推导的 opaque handle，只能映射 Core 已准备好的文件，不接受任意用户路径或
provider URL。

`media.ts` 自己维护一个极薄的 Atom-owned HTTP listener，只服务 UPnP media，不承载 Core
Control、Web UI、WebSocket 或 Desktop External API。这样 Desktop 与 Headless 行为一致，且
不改变现有 `externalApi.enabled/allowLan` 的启动和暴露语义。listener 使用临时端口，按需要
启动并在无资源/退出时释放。

## 4. 输出身份与现有 Control 复用

UPnP 继续使用现有 `AudioDevice`：

```text
id: upnp:<UDN>
name: Renderer friendlyName
isDefault: false
```

不为 UPnP 扩 `AudioDevice.kind/availability/capabilities`，也不修改 `PlayerStatus` schema。
`upnp:` 与现有 `diretta:` 一样由稳定 ID namespace 区分。

沿用现有 Core Protocol：

```text
GET  /output/devices
POST /output/select
GET  /status
现有 play/pause/stop/seek/session/event
```

`GET /output/devices` 继续作为刷新动作，合并 local + Diretta + UPnP 扫描结果，不新增
`/output/refresh`。Desktop/Web 现有 output selector 继续消费同一 `AudioDevice[]`；Web output
projection 只需允许 `upnp:` 通过。

`GET /status` 在 UPnP 被选中时读取 `output.ts` 的最近观察值，否则保持现有 native status
路径。`volume`/`speed` 保持现有 number contract；它们是 Atom 本地播放器设置，不代表远端
Renderer 的 RenderingControl 状态。UPnP 媒体本身不经过这些本地 DSP/volume 设置。

首版不调用 RenderingControl SetVolume/SetMute，也不为了 UPnP 修改共享音量类型或 Core
Protocol version。

## 5. PlaybackSession 最小接入

`electron/main/services/playbackSession.ts` 已经是 Atom-owned Core playback authority，因此
不新增 `IOutput`、Output registry 或 adapter hierarchy。

### load

`loadIndex()` 保持现有 source resolver 和 policy：

```text
resolvePlaybackSource(track)
        |
        +-- selected output is upnp:
        |     prepare media resource
        |     output.load(resource)
        |     publish existing Track/NowPlaying/stats projection
        |     return
        |
        +-- otherwise
              existing loadPlayerSource() path unchanged
```

native/local/Diretta 分支尽量保持原代码原位，避免未来 upstream sync 冲突。

UPnP 不伪造 `AudioPlayer` 或 native `LoadResult`。需要的 presentation、NowPlaying、Netease、
ListenBrainz 和 Core play stats 优先复用现有公开 helper；只有实际出现稳定重复时才提取共同
提交 helper。`directGapless.ts` 已经证明特殊执行路径可以直接复用这些现有服务，而无需重构
`playerLoad.ts`。

### play / pause / stop / seek

`playbackSession.play/pause/stop/seek` 在 `upnp:` 选中时委托 `output.ts`，否则保持现有 native
调用。现有 Desktop 主 UI、Web Control、系统媒体的 Play/Pause/Stop/Seek 已经主要委托
playbackSession，因此无需为 UPnP 新建 Control API。

旧 IPC 中与 DSP/FFT/native device 明确绑定的能力继续属于 native player，不为 UPnP 进行全局
重构。UPnP 首版只保证标准播放命令走 Core authority。

### output switch

`setOutputDevice()` 采用 early branch：

```text
target upnp        -> switchToUpnp() -> return
previous upnp      -> switchFromUpnp() -> return
native <-> native  -> existing implementation unchanged
```

切换时尽力保存当前播放意图和位置。目标支持 seek 时恢复位置；不支持时从头加载或保持暂停，
具体行为以首个参考 Renderer 验收后固定。Renderer Stop/SetURI 等失败直接让本次切换失败，不在
首版建立 stop-unconfirmed 状态机、force-confirm API 或复杂 rollback framework。

### preload

UPnP 首版不建立第二套 preload，也不 `SetNextAVTransportURI`。现有普通 source resolve preload
可以继续复用，但不得触发 Diretta native staging。Diretta 判断应以 Core-owned
`player.outputDevice` 为准，避免 UPnP 被选中后 native player 仍保留旧设备造成误判。

## 6. 媒体准备

### 本地文件与已有缓存

独立 FLAC/WAV/MP3/AAC/M4A/DSF/DFF 等，如果 Renderer 可直接接受，优先原文件 byte-identical
HTTP 服务。Range 重开仍读取同一不可变文件。

### 在线平台

Netease/Qobuz/TIDAL/streaming/plugin 全部继续调用现有 `resolvePlaybackSource()`。UPnP 不知道
provider 协议，也不解析 manifest。

若 resolver 已返回本地 path/cache path，直接服务。若仍为 HTTP(S)，首版先完整物化后提供给
Renderer，不做边下边播 relay。

`electron/main/atom/directInput.ts` 已有 exact HTTP bytes -> `.part` -> rename 的实现。实现时先
复用其可复用部分；如果 Diretta 专属 temp/lifecycle 使直接复用不成立，再提取最小的 Atom-owned
exact-byte helper。Diretta 和 UPnP 仍分别拥有 temp root 与 cleanup lifecycle，不复制下载实现，
也不让 UPnP 依赖 Diretta 目录语义。

### 临时资源生命周期

首版不建立持久化 extraction cache、fingerprint database、pin/evict framework 或转换资源
registry。每次 generation 只生成当前所需资源：

```text
create unique .part
-> generate/copy complete file
-> generation still current ? rename/publish : delete
-> stop/change/shutdown -> release/delete temporary resource
```

重复播放同一分轨允许重新生成。只有真实性能数据证明必要后，才在现有 `media.ts` seam 上加入
缓存，不改变 Core architecture。

## 7. 格式与保真策略

| 输入 | 首选交付 | 保证 |
| --- | --- | --- |
| 独立普通文件 | 原文件 | byte-identical |
| 整数无损 PCM CUE | 独立 PCM WAV/WAVE_FORMAT_EXTENSIBLE | rate/channel/有效位深/sample value 保持 |
| SACD ISO stereo track | 未压缩 DFF | 轨道范围与 logical DSD sequence 保持 |
| 独立 DSF/DFF | 原文件 | byte-identical |
| DSD CUE | 独立 DSF/DFF | logical DSD sequence/rate/channel 保持 |
| 必要的 DSF<->DFF 兼容封装 | 等价容器 | 仅布局/bit-order 机械适配，不改 logical DSD sequence |

MP3/AAC 等有损源仍可作为独立文件原格式发送，但不把其 CUE 分轨声明为无损整数 PCM 提取。
浮点 PCM CUE、未知有效位深、未知声道布局或不能精确确定边界的输入明确不支持。

### CUE

UPnP CUE 不使用渲染层 `cueStartMs` 反推边界，而复用现有 Rust CUE parser 的 75 fps 原始坐标。
同一母版相邻轨共享同一个绝对边界，区间为 `[start, end)`；最后一轨到真实 EOF。沿用现有
INDEX 00/01、pregap 与多 FILE 语义，不另造 Track identity。

首版 CUE representation 改为 PCM WAV/WAVE_FORMAT_EXTENSIBLE，而不是为了 UPnP 新增 FLAC
encoder。复用现有 strict integer `DirectPcmDecoder`，只做精确 seek/decode/crop 和 WAV header
写入；不经过 swr/f32/dither。以后真实 Renderer 兼容性证明 FLAC 必要时，可在同一 extraction
seam 增加 FLAC writer，而 Core、UPnP protocol 和 media server 均无需改变。

### SACD ISO

只接受明确 stereo area/2ch track。复用现有 `SacdTrackReader`；UPnP 不负责修正 SACD reader
或 DST decoder。未压缩 DSD 直接读取 logical DSD stream；compressed DST 只有在现有 decoder
独立 correctness gate 通过时才支持，否则该输入明确失败。

首选写出未压缩双声道 DFF。DSF 兼容封装只有真实 Renderer 需要时再增加。

### Native DSD

独立 DSF/DFF 能原文件播放就不改写。必要的 DSF/DFF 等价封装只允许声道布局重排和每字节
bit-order 转换，保持有效 sample/bit count、rate、channel identity 与 logical one-bit sequence。
padding 不计入有效序列；无法等价表示时明确失败，不补静音 bit、不转 PCM。

## 8. Native 修改边界

普通文件 UPnP 播放不需要修改 `audio-engine-core`。

CUE/ISO/DSD 分轨阶段如确实需要 native 文件生成，只新增一个离线 consumer：

```text
native/audio-engine-core/src/media_extract.rs
```

它复用现有 public reader：

```text
cue/*
DirectPcmDecoder / DirectPcmFrame
SacdTrackReader
DsfReader / DffReader
现有 DST decoder
```

不修改 `player/*`、normal decoder/DSP、Diretta runtime 或 existing Direct playback semantics。

NAPI 不向 `AudioPlayer` 增加 UPnP 方法。若 Node Core 必须调用 native extraction，则新增一个
Atom-specific 薄导出文件，例如：

```text
native/audio-engine/src/atom_media_extract.rs
```

只把参数传给 `audio_engine_core::media_extract` 并返回文件级结果。现有 upstream-oriented
`bindings/player.rs` 保持不变；不新增第二 native addon。

## 9. 状态、结束与统计

首版 `output.ts` 在播放期间低频轮询 Renderer。`/status` 只是读取最近观察，不因为多个 Control
增加设备请求频率。

自然结束采用最小保守条件：当前 generation 曾观察到 PLAYING，之后观察到 STOPPED，位置接近
已知 duration，且没有当前 Core 主动 stop/switch/seek intent；满足后调用现有 Core ended/next
policy。不能确认自然结束时保持 stopped，不盲目推进。

NowPlaying、Netease、Core play stats、ListenBrainz 继续使用现有服务，不创建第二 tracker。
UPnP 观察到实际 PLAYING 后才开始/恢复 playing wall-clock；Pause/Stopped 停止累计。输出切换或
同曲 reload 延续现有同曲统计语义，自然下一首/repeat 建立新播放会话。

## 10. 首版不实现但架构应允许增加的能力

以下都不是基础 UPnP 输出的前置条件：

- GENA SUBSCRIBE/NOTIFY；
- ConnectionManager `PrepareForConnection`；
- `SetNextAVTransportURI` / gapless；
- SCPD 动态 capability model；
- Renderer quirk registry；
- persistent representation cache；
- 在线 source relay；
- 多房间/同步；
- RenderingControl 音量控制。

这些需求出现时应主要增长 `discovery.ts`、`transport.ts`、`output.ts` 或 `media.ts`，而不是再次
修改 queue、provider、Core Protocol 或 audio playback architecture。

## 11. 实施阶段

| 阶段 | 工作 | 完成证据 |
| --- | --- | --- |
| P0 | 同步 scope；锁定 SSDP/XML 依赖；建立四模块骨架 | AGENTS/roadmap/方案一致；无共享 schema 扩张 |
| P1 | 发现、SOAP、DIDL、独立 media listener、普通本地文件 | 参考 Renderer 单曲闭环；原文件 hash/Range 一致 |
| P2 | playbackSession/output/status/切换/自动 next 接入 | 三首无 Control 连续播放；native/local/Diretta 路径回归 |
| P3 | 在线 source 完整物化，复用 resolver/cache/exact-byte helper | Netease/Qobuz/TIDAL/streaming source 不新增协议实现 |
| P4a | CUE -> exact PCM WAV | 多 FILE/INDEX/pregap/边界/有效位深逐样本对照 |
| P4b | SACD ISO -> DFF | stereo track 首/中/末轨 logical DSD 序列对照；mch 拒绝 |
| P4c | DSD CUE 与必要 DSF/DFF 等价封装 | 多 DSD rate、padding、bit-order/声道身份对照 |
| P5 | 根据真实设备补必须的 UPnP compatibility | 新能力局限在 UPnP seam，不扩大 Core architecture |
| P6 | 故障、长播、最终 artifact 与兼容矩阵 | UPnP<->ALSA/Diretta 回归、资源稳定、真机记录 |

## 12. 测试与发布门禁

### 协议与 Core

- SSDP 重复响应、无设备、重复刷新、进程退出无残留 socket/timer。
- description 相对 URL、XML namespace、SOAP Fault 与超时。
- GET/HEAD/single Range/206/416；原文件完整和 Range 重组 hash 一致。
- mock Renderer 实际拉取媒体，验证 SetURI/Play/Pause/Stop/Seek 与状态轮询。
- 手动 stop 不自动 next；自然结束只消费一次；旧 generation 不污染新资源。
- UPnP 路径不调用 native `AudioPlayer.load/play`、DSP 或 Diretta stage。
- `/output/devices` 与 Desktop/Web 现有 selector 无新协议 schema 即可工作。

### CUE / SACD / DSD

- CUE 使用逐样本 pattern 比较输出 WAV 解码后的 PCM 与母版区间，覆盖 16/20/24/32 valid bits、
  常见 sample rate、相邻轨、末轨、INDEX 00/01、多 FILE 与无 seektable 输入。
- ISO 使用已知 DSD pattern 或独立结果逐声道逐 bit 对照；Track 1/中间/末轨、缺失 stereo area、
  compressed DST failure 都有明确 fixture。
- DSF/DFF 等价封装按统一 logical sequence 比较，padding 不参与序列；多声道明确拒绝。
- native extraction worker 不打开 ALSA/Diretta，不进入实时 callback，不向 JS 返回整轨 PCM/DSD
  buffer。

### 真机

- 指定参考 Renderer 的普通 FLAC/WAV/MP3/AAC/M4A 与其实际支持的格式/rate。
- CUE WAV、SACD DFF、原文件 DSF/DFF；设备不支持的组合明确失败。
- 自动三首、repeat、pause/resume、seek、手动 next、关闭全部 Control。
- UPnP <-> ALSA/Diretta 双向切换以及 Core restart/SIGTERM。
- 长时间混合普通/CUE/ISO/DSD 队列，确认 FD/socket/timer/temp file/RSS 不随曲目数持续增长。

真实 Renderer 能接收资源不等于 DAC bit-perfect。最终兼容矩阵分开记录：Core byte/sample/DSD
序列保持、Renderer 接受的容器/rate，以及有测量条件时的实际 DAC 输出结果。

## 13. 架构完成审查

完成每个 UPnP 阶段前确认：

- 是否仍只有 Core 一个 queue/provider/playback policy authority；
- 是否主要新增/修改 Atom-owned 代码；
- 是否为了 UPnP 改写了不必要的 shared schema、上游 UI、native player 或 Direct runtime；
- 新 UPnP 能力是否可以只在四个稳定模块内部增长；
- 是否优先发送原文件，只有明确必要时才进行样本/逻辑 DSD 序列保持的转换；
- 是否引入了没有真实需求的 registry、状态机、缓存层或 fallback。

如果任一项暴露出广泛 upstream/native touch，应先重新设计 seam，再继续实现。

## 14. 参考

- UPnP Device Architecture 1.1：SSDP、description 与 SOAP 基本语义。
- AVTransport Service：SetURI、Play/Pause/Stop/Seek 与 transport/position 状态。
- `/home/bnqzzdf/code/tinyLMS`：仅作为 UPnP/CUE/SACD 行为参考，不作为 Atom 产品架构来源。
- Atom 当前可复用 seam：`playbackSession.ts`、`playbackSourceResolver.ts`、`songCache.ts`、
  `directInput.ts`、`direct_pcm.rs`、`cue/*`、`sacd/*`、`dsd/*`。
