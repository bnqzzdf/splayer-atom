# SPlayer Atom 已完成事项

这是[路线图](./atom-roadmap.md)的已完成事项档案。一条已记录的测试仅适用于其声明的源码提交、产物与
设备。其余验收仍留在路线图上。

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
  [硬件清单](./hardware-release-checklist.md)。
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
  [ALSA 计划](./alsa-output-plan.md)记录了仍需要的结构性运行时/缓冲工作。
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
- 响应式 Web 布局具备共享的 768/1280 px 断点、移动端导航、紧凑播放栏、自适应列表、完整播放器、
  设置与对话框。已批准的队列拖拽与重复歌曲行双击交互被移除。设备验收仍未完成。
- 歌词 P0/P1 已实现：显式平台回退、经校验的候选选择、非阻塞 TTML 显示升级、首选插件竞争，以及
  针对源质量与 YRC/QRC/KRC/TTML 间距的回归覆盖。见[歌词改进](./lyric-improvements.md)。

## 打包基础工作

- 运行时兼容性检查、参考 Node 运行时、系统/内置变体与 Linux CI 打包均已就位。暂存会检查原生加载、
  插件宿主、HTTP/WS/Web 启动与终止。Diretta 打包校验所需的 SDK；文件名包含版本与日期。
- Debian 11 内置构建器现在会选择显式的无 Diretta 或 SDK 150 Diretta 变体，并检查原生 glibc 需求
  与产物能力。2026-09-23，无 Diretta 与 Diretta v3 包通过容器构建与抽取产物冒烟测试；全部三个
  打包的原生模块最多要求 glibc 2.30。这是一次脏工作树的软件运行，该记录中没有 Diretta 硬件结果或
  v2/v4 构建。
- 持久 `data/`、迁移备份、升级与回滚流程记录在 [Core 部署](./core-deployment.md)中。在固定的最终
  候选上完成一次完整的安装/升级/回滚运行仍是未完成的发布门禁。
