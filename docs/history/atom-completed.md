# SPlayer Atom 已完成事项

> 最后更新：2026-11-05

> 历史方案或测试记录：当前状态及未完成验收请以[路线图](../atom-roadmap.md)为准。

这是[路线图](../atom-roadmap.md)的已完成事项档案。一条已记录的测试仅适用于其声明的源码提交、产物与
设备。以下「2026-11-05 结项」反映维护者最新的完成状态；下文原有测试记录继续保留当时的证据边界。

## 2026-11-05 路线图结项（40 项）

维护者在最新版中文 Roadmap 中将原有及新增的 **40 项均标记为完成**，因此将清单从路线图迁至此处。
其中代码实现及历史测试有提交或记录可追溯；部分**新增勾选的设备、真实账号、浏览器、长期运行及
发布验收**尚未在仓库中找到对应的新增报告。这些项目记录的是维护者本次确认的**完成状态**，
不表示此次整理重新执行了测试或生成了验收证据，也不应把旧候选包的结果移作 v1.2.0 的测试报告。

### ALSA、Diretta、UPnP（9 项）

- [x] ALSA HW Direct/Processed、PCM/Native DSD、共享 `AlsaFrameWriter`、单运行期与有界队列实现，
  以及软件和局部运行验证，见 [ALSA 方案](./alsa-output-plan.md)。
- [x] 2026-09-22 FC4 Direct PCM/DSD 与生命周期检查、2026-09-23 已安装产物 `3e420f78` 上
  Processed seek/重启播放复测，见 [FC4 记录](./alsa-acceptance-2026-09-23.md)。
- [x] Diretta Source Direct PCM 最高 768 kHz、Native DSD 最高 DSD512 精确性实机验证，以及
  PCM/DSD 混合队列过夜播放，见[硬件清单](../hardware-release-checklist.md)。
- [x] UPnP Core 输出和 CUE/SACD 物化、历史 AudioSys 实机检查、媒体监听器 100 次提前断开回归，
  见 [UPnP 方案](./upnp-output-plan.md)。
- [x] Diretta Direct CUE 75 fps 边界、预备与 Native 无缝衔接实现及自动化检查，
  见 [Direct CUE 方案](./direct-cue-gapless-plan.md)。
- [x] 维护者确认：干净候选 Core 产物中的 ALSA 方案变更验收已完成，覆盖模式、格式、切换和资源趋势。
- [x] 维护者确认：目标设备上的 ALSA 格式、生命周期及适用的精确性边界验收已完成。
- [x] 维护者确认：发布候选上的 UPnP 真实渲染器复验、长时资源检查及兼容性矩阵已完成。
- [x] 维护者确认：真实 Diretta Target 的 CUE 无缝、PCM/DSD 边界、seek、队列变化和长时验收已完成。

### Provider、ListenBrainz 与 Web Control（14 项）

- [x] Netease、QM、KG、Qobuz、TIDAL 的 Core/Web 接入、会话、搜索及相关协议路径实现。
- [x] ListenBrainz Now Playing、永久收听、持久 outbox、重试与独立子进程实现及自动化检查。
- [x] 响应式 Web 的 768/1280 px 断点、移动导航、列表、播放器、设置与弹窗实现。
- [x] Core 产物多 WebSocket 客户端及重连冒烟验证。
- [x] UI-1：AM 播放器、三布局切换、旧偏好迁移和复用播放控制，`09aa92f1`。
- [x] 维护者确认：UI-1 多视口浏览器／设备验收（连续播放、歌词／队列、后台恢复、Direct 控件）完成。
- [x] UI-2：常规／紧凑列表、虚拟滚动高度调整、按页面排序隔离及自动化回归，`125f35a8`。
- [x] 维护者确认：UI-2 长列表、多碟、当前曲目定位、移动触控、切换密度与排序恢复验收完成。
- [x] FIX-1：Core 在写入前拒绝嵌套扫描根目录，Web 不再执行反向删除，`b2a6b1e9`。
- [x] FIX-2：从下载响应文件名识别音频扩展名，避免无依据的 `.mp3` 推断，`56b41611`。
- [x] 维护者确认：五个平台真实账号全流程验收完成。
- [x] 维护者确认：ListenBrainz 真实 token、401/429、离线重试与重启验收完成。
- [x] 维护者确认：响应式 Web 代表性视口及真实移动设备交互验收完成。
- [x] 维护者确认：多个真实 Web Control 在刷新、断开与重连场景下的长时验收完成。

### 文件夹浏览（10 项）

- [x] Core Folder Browser 的分页、固定目录、搜索／筛选、列表／网格、CUE/SACD、素材、范围扫描、
  递归／批量操作和“所在文件夹”实现。
- [x] 第一批 Core 显示排序、物理属性、分组、分页前排序及游标校验。
- [x] 第一批 Web 排序偏好、历史恢复、逐目录筛选、返回定位与列表／网格偏好。
- [x] 第一批物理文件名、操作范围提示、全结果选择、搜索截断提示。
- [x] 2026-09-28 当前真实曲库第一批功能验收，含超过 200 项分页、筛选及 CUE/SACD 定位；
  当时 Node 428/428、Web 111/111。
- [x] 维护者确认：NAS/USB、超大目录与素材查看器的扩展人工验收完成。
- [x] 维护者确认：Folder Search 延迟测量分析及按结果决定的处理已完成。
- [x] 物理路径查询、局部扫描及投影刷新优化，`75561bad`、`2041c17b`。
- [x] 第二批当前子树递归搜索、文件夹关联专辑／艺术家、批量失败提示实现，`b65bcd91`。
- [x] 维护者确认：第二批真实曲库及浏览器交互验收完成。

### 构建与发布（7 项）

- [x] Node/Bun 共用 Core 代码、四种 system/bundled Flavor 构建、staging、冒烟与插件 Host 基本检查，
  `85b5aa86`；`mise.toml` 固定 Node 24.22.2、Bun 1.4.4。
- [x] 2026-11-04 Node/Bun 空库 API 基准与真实曲库基本加载、FLAC 播放／切歌对照。
- [x] 2026-09-23 Debian 11 无 Diretta 与 Diretta v3 bundled 构建／抽取冒烟（历史 SDK 150）。
- [x] 产品升级到 `1.2.0`，提交 `5b8773c3` 与 `v1.2.0` Git Tag 已推送到 GitHub；
  Git Tag 不自动创建 GitHub Release。
- [x] 维护者确认：实验 Bun 的目标设备格式／输出、切歌 seek、插件 Host、长稳、
  Debian 11/OpenRC、升级和回滚验收完成。
- [x] 维护者确认：干净目标提交的最终构建、硬件／部署清单、安装／升级／回滚验收完成。
- [x] 维护者确认：稳定版发布准备及产物提交、hash、能力集和验收结果记录已完成；
  本次文档整理未创建额外 GitHub Release。

以上完成状态不再占用当前 Roadmap；历史方案和先前的未完成描述，仍按其各自的撰写日期解读。

## Web + Core 基础

- 音乐领域状态、设置、媒体库、队列、provider、播放策略、缓存、下载、统计、插件与输出选择已迁移至
  Node Core。Web Control 使用 Core HTTP/WS 命令、快照与事件。
- Core 源码迁移到 `core/**` 下；Electron 运行时、preload/renderer IPC、窗口、托盘、桌面歌词、
  更新器、桌面协议、仅桌面端的 crate 以及 Windows/macOS 打包均被移除。Web Vite 构建与
  Linux x86-64 Core 产物即应用路径。
- 旧的 Web `window.api`/Host 兼容层与仅桌面端的能力分支被移除。项目构建的原生插件为
  `audio-engine.node` 与 `streaming-api.node`。
- ALSA、Diretta 与 UPnP 进入同一个 Core 播放权威。Core 处理 CUE/SACD 虚拟轨道。ListenBrainz
  会话及其持久发件箱由 Core 所有；禁用模式不启动 worker，启用时 SQLite/HTTP/重试工作运行在隔离的
  子进程中。

## 音频与输出实现

- Diretta 精确 PCM Source Direct 具备直到 768 kHz 的真实目标 bit-perfect 证据；Native DSD 具备
  直到 DSD512 的真实目标逻辑一位验证。混合 PCM/DSD 队列完成了整夜切换运行。见
  [硬件清单](../hardware-release-checklist.md)。
- ALSA HW 后端实现 Direct/Processed 模式、精确 PCM/Native DSD、有损播放与现有 PCM DSP。
  Core/Web 模式与能力处理已整合，CPAL 输出已移除。当实际路径不允许时，Web 控件会抑制仅 Direct 的
  指示器与 DSP 操作。开发期的 ALSA 试听与参数检查报告于 2026-09-22。
- 在 `cecee166` 上，FC4 硬件检查通过了 Direct PCM/DSD64 的播放、暂停、定位与切换；
  Processed PCM 播放通过，但定位失败。独立 USB 提交比对匹配了 1,414,748 个 PCM 字节与
  5,658,992 个 DSD 字节。ALSA/Diretta 切换、FC4 重连、systemd 重启、SIGTERM 与产物 WebSocket
  重连在其记录范围内通过。干净的 Diretta 归档匹配全部 220 个已安装非数据文件，并通过抽取产物
  冒烟测试。见 [2026-09-22 记录](./alsa-acceptance-2026-09-22.md)。
- `c3e135ab` 包含针对 Processed 定位与重启后播放失败的软件修复。二者在已安装的干净产物
  `3e420f78` 上通过 FC4 复测；见 [2026-09-23 记录](./alsa-acceptance-2026-09-23.md)。
  后续共享 writer、单一运行期归属和有界队列/池已实现；
  [本地模块复测](./alsa-gap-fixes-2026-09-23.md)覆盖截至 `53284360` 的源码。
  [ALSA 计划](./alsa-output-plan.md)和路线图仍保留干净产物与设备验收。
- UPnP 共用 Core 队列、源与缓存流程；其 CUE/SACD 物化与 Direct/普通播放隔离。
  [UPnP 计划](./upnp-output-plan.md)记录了 AudioSys 播放、抽取比对与初步长跑证据，以及仍未完成的
  稳定性门禁。
- Direct CUE 使用 Core 所有的暂存与精确的 75 fps 边界，并具备原生无缝衔接。自动化检查记录在
  [Direct CUE 计划](./direct-cue-gapless-plan.md)中。

## Provider、Web 与歌词

- Core 暴露面向 Netease、QQ Music、Kugou、Qobuz 与 TIDAL 的无凭据会话投影与 provider 能力。QM/KG
  具备 Core 支持的二维码/手动 Cookie 登录、搜索与收藏页面，以及带插件回退的 Core 源解析。Qobuz
  具备浏览器 OAuth，包含一次性回调监听与仅 token 登录；Core 持久化产生的会话。`streaming-api`
  实现 Qobuz 协议与 TIDAL 认证/请求/manifest/DASH；Core 整合 TIDAL JSON/BTS 与 DASH 物化。
  部分真实的 Netease/TIDAL UPnP 在线路径记录在 [UPnP 计划](./upnp-output-plan.md)中。全部五个
  provider 的完整真实账号验收仍按路线图推进。
- Web Control 暴露媒体库、播放列表、队列、播放、下载、统计、缓存、provider、设置与插件。Core
  所有的 Folder Browser 现在提供分页浏览、未扫描媒体与 CUE/SACD 访问、范围扫描、固定文件夹、
  搜索/过滤、素材、列表/网格视图、递归与批量操作，以及共享的所在文件夹操作。实现已合并进 `dev`；
  真实媒体库的 UX 验收仍未完成。
- 文件夹列表/网格偏好已在 `058c0e63` 持久化。
  [文件夹浏览改进方案](./folder-browser-improvements.md)的第一批显示排序、文件信息与交互改进已实现，
  并于 2026-09-28 完成真实曲库和浏览器下的功能验收；NAS/USB、大目录与素材查看器的更广验收仍待完成。
- `75561bad`（2026-11-03）优化文件夹物理路径的索引查询，减少全库扫描；
  `2041c17b`（2026-11-04）将局部扫描的读取限制到对应目录，并让曲目投影按需刷新。
  两项均有相应自动化回归；真实曲库中的性能收益尚需按场景复测，见[路线图](../atom-roadmap.md)。
- `09aa92f1` 的 UI-1 实现 AM 风格播放页、经典/全屏封面/AM 快捷切换、
  浏览器本地 `player.layout` 偏好及旧 `coverLayout` 迁移，并把共用播放控制抽到
  `PlayerTransport.vue`。Node 491/491、Web 159/159，以及类型检查、构建和 lint 均通过。
  **各视口浏览器截图与真实播放验收仍待完成**，
  见[上游 UI 分批计划](./upstream-ui-adoption-plan.md)。
- UI-2 已实现共用歌曲列表密度切换（88px／56px）、虚拟列表高度重测、
  固定页面类别的排序偏好，以及旧全局排序清理；自动化覆盖跨页面隔离与持久化。
  真实浏览器滚动、多碟、手机触摸目标验收仍待完成。
- 响应式 Web 布局具备共享的 768/1280 px 断点、移动端导航、紧凑播放栏、自适应列表、完整播放器、
  设置与对话框。已批准的队列拖拽与重复歌曲行双击交互被移除。设备验收仍未完成。
- 歌词 P0/P1 已实现：显式平台回退、经校验的候选选择、非阻塞 TTML 显示升级、首选插件竞争，以及
  针对源质量与 YRC/QRC/KRC/TTML 间距的回归覆盖。见[歌词改进](./lyric-improvements.md)。

## 打包基础工作

- `85b5aa86`（2026-11-04）统一 Node/Bun 的 Core 构建、staging、artifact smoke 和启动入口，
  支持 Node/Bun 各自的 system/bundled Runtime Flavor；`0e590b43` 用 `mise.toml`
  固定 Node `24.22.2` 与 Bun `1.4.4`。Bun 已有隔离的 plugin Host 进程和空库 API 对照基准，
  但还没有正式硬件、长时播放和发行验收。见[运行时对照](./bun-runtime-experiment.md)。
- 运行时兼容性检查、参考 Node 运行时、系统/内置变体与 Linux CI 打包均已就位。暂存会检查原生加载、
  插件宿主、HTTP/WS/Web 启动与终止。Diretta 打包校验所需的 SDK；文件名包含版本与日期。
- Debian 11 内置构建器现在会选择显式的无 Diretta 或 Diretta 变体，并检查原生 glibc 需求
  与产物能力。2026-09-23，无 Diretta 与 Diretta v3 包通过容器构建与抽取产物冒烟测试；全部三个
  打包的原生模块最多要求 glibc 2.30。这是一次脏工作树的软件运行，该记录中没有 Diretta 硬件结果或
  v2/v4 构建。当时使用 SDK 150；当前源码已在 `0daa2cfd` 更新为 SDK 148，
  不应把历史验收等同于当前 SDK 148 产物的验收。
- 持久 `data/`、迁移备份、升级与回滚流程记录在 [Core 部署](../core-deployment.md)中。在固定的最终
  候选上完成一次完整的安装/升级/回滚运行仍是未完成的发布门禁。
