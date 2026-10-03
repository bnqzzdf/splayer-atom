# SPlayer Atom

> 最后更新：2026-10-03

**简体中文** · [English](./README.en.md)

SPlayer Atom 是在 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 基础上修改的 Linux x86-64 音乐播放器，采用 **Node Core + Web Control** 架构：后台 Core 负责曲库、在线服务、播放队列与音频输出，日常操作在浏览器里完成。

Core 常驻运行，适合长期开着放音乐的 Linux 主机、音乐服务器与 HiFi 主机；电脑、平板、手机可以同时连同一个 Core，实时看到同一份播放状态。关闭浏览器页面不会中断播放。

## 运行架构

```text
        电脑 / 平板 / 手机浏览器（可多个同时连接）
                        │ HTTP + WebSocket（默认 :14558）
                        ▼
        ┌──────────────────────────────────────────────────┐
        │ SPlayer Atom Node Core（常驻进程）               │
        │                                                  │
        │  Web Control 静态页（renderer/，由 Core 直接提供）│
        │  HTTP API + WS 事件推送（core/server、atom）     │
        │  曲库 / 扫描 / 设置 / 队列 / 缓存 / 下载         │
        │  在线平台接入（core/apis）                       │
        │  自建媒体服务接入（Subsonic/Jellyfin 系 8 类）   │
        │  插件宿主 —— 独立子进程                          │
        │  ListenBrainz —— 独立子进程（关闭时不跑后台）    │
        └───────────────────────┬──────────────────────────┘
                                │ napi
        ┌───────────────────────▼──────────────────────────┐
        │ 原生扩展（Rust）                                 │
        │  audio-engine    解码、ALSA、Diretta、DSD、      │
        │                  CUE / SACD 虚拟分轨、DSP 处理   │
        │  streaming-api   Qobuz / TIDAL 协议与取流        │
        │  diretta-sys     Diretta Host SDK 绑定与兼容层   │
        └───────────────────────┬──────────────────────────┘
                                ▼
        输出后端：ALSA · Diretta Source Direct · UPnP Renderer
```

### 各部分职责

- **Node Core**（`core/`）：唯一权威状态所在。曲库与 SQLite 数据库、扫描、设置、播放队列与播放策略、音源解析、缓存与预载、下载、在线平台会话与凭据、插件运行时、听歌统计、输出设备与 Diretta 直通。对外只暴露 HTTP/WS 接口（`core/server/`、`core/atom/headless/`），播放决策不交给浏览器。
- **Web Control**（`src/`）：Vue 3 + TypeScript + Pinia + vue-router + vue-i18n + UnoCSS 写的界面，构建产物 `out/renderer/` 由 Core 直接托管，不需要单独部署前端。它只发送高层命令、消费 Core 推送的快照与事件。
- **原生扩展**（`native/`）：`audio-engine` 负责解码与音频输出（ALSA、Diretta、DSD、CUE/SACD 虚拟分轨，以及均衡器/响度/变速等处理），`streaming-api` 负责 Qobuz / TIDAL 的原生协议与取流，`diretta-sys` 绑定 Diretta Host SDK 并提供旧 glibc 的兼容垫片。
- **共享契约**（`shared/types/`）：跨进程与前后端共享的类型定义，是 Core 与 Web 之间唯一的接口约定。
- **脚本与打包**（`scripts/atom/`、`docker/`）：构建、打包、产物自检、发布标签、硬件验收脚本，以及 Debian 11 容器化构建。

### 数据与持久化

安装目录下的 `data/` 是**持久状态**，升级时必须保留：

| 位置                       | 内容                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `data/database/`           | SQLite 曲库与播放历史（better-sqlite3）                                  |
| `data/config/`             | 设置、在线平台会话与凭据                                                 |
| `data/backups/migration-*` | schema 迁移前的快照（确实需要迁移时才会生成）                            |
| 缓存目录                   | 封面与音频缓存等可重建内容，遵循 Core 的 XDG 缓存路径，不放在安装根内    |
| `data/logs/`               | Core 与 native 的运行日志（生产环境同时输出到 stdout，由 journald 接管） |
| `data/plugins/`            | 插件脚本与其自带数据、日志                                               |

Core 拒绝比当前构建更新的数据库或设置 schema；生产日志输出到 stdout/stderr，由 systemd/journald 接管。

## 主要能力

**本地曲库**

- 目录扫描与增量更新、扫描进度推送；搜索、专辑/歌手聚合
- 标签编辑、文件夹浏览与固定、CUE 虚拟分轨、SACD stereo 虚拟分轨
- 歌词：本地 TTML 歌词库、匹配、双语/逐字滚动与偏移调整（支持 LRC/QRC/YRC/KRC/TTML/LyS/SRT/ASS）
- 私人 FM、每日推荐、云盘、歌曲评论

**在线服务**

- 五个平台的接入与登录：网易云音乐、QQ音乐、酷狗音乐、Qobuz、TIDAL
  （扫码 / Cookie / 浏览器 OAuth；凭据与播放地址由 Core 持有，Web 端只读投影）
- 平台首页：榜单、新碟上架、热门歌手、分区「查看全部」；在线图片经 Core 代理与缓存
- 自建媒体服务：Subsonic / Navidrome / OpenSubsonic / Airsonic / Gonic / LMS / Jellyfin / Emby 接入、搜索与同步
- 歌手头像等元数据补全（MusicBrainz）

**播放与输出**

- ALSA 输出；普通 PCM 路径提供均衡器、响度、变速等 DSP 功能
- **Diretta strict Source Direct**：源采样率、声道数、有效位深与样本原样透传，Native DSD 保持逻辑 one-bit 序列；绝不静默重采样、混音、DSP 或回落 PCM，也不走 `f32` DSP/重采样路径
- UPnP 单 Renderer 输出，与本地输出共用同一套队列与音源处理流程
- 队列与播放模式、无缝播放（CUE 与普通分轨）、预载与缓存

**运行时与运维**

- 插件运行时：单个宿主子进程承载所有插件（心跳与崩溃恢复），兼容 LX `user_api` 脚本，按 `@apiLevel` / `@grant` 声明能力
- ListenBrainz：Now Playing 与 Scrobble，独立子进程，关闭时不产生后台工作
- 下载管理、播放统计、缓存管理、网络代理设置；`/debug` 诊断页（展示 Core 连接与播放链路状态）
- 多客户端实时同步：所有 Web Control 共享 Core 的队列与播放状态。状态类变更由 WS 实时推送
  （`status`、`libraryChanged`、`providerSessions`、`downloadProgress` 等）；逐帧播放进度不走 WS，
  而是页面可见时按 500ms 轮询 `/api/status`，避免把高频事件推给所有客户端

**边界与约束**

- 宿主媒体文件归用户所有：Atom 不提供删除音乐文件的命令或界面，清理只涉及自己产生的缓存/临时/半成品文件
- 严格 Diretta 下不做任何改变采样的处理；不支持的 Target 格式会明确报错，而不是悄悄回落

## 环境要求

- Linux x86-64
- Node.js `>=22.19.0`（**正式构建固定使用 24.18.0**，由构建脚本硬校验）
- pnpm `>=10`
- Rust stable
- ALSA 开发头文件、Clang、pkg-config

Ubuntu/Debian 类系统：

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y \
  libasound2-dev pkg-config clang
```

## 开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 先构建 debug native addons，然后启动 Node Core 与 Web Vite 开发服务。

常用检查：

```bash
pnpm typecheck
pnpm test               # Node 契约测试 + Web 单元测试
pnpm lint
pnpm build
cargo check --workspace
cargo test --workspace
pnpm docs:build
pnpm docs:stamp:check   # 文档时间戳是否需要刷新
```

## 构建

```bash
pnpm build
```

完整构建顺序：构建 `audio-engine.node` 与 `streaming-api.node` → Node/Web typecheck → 打包 Node Core → 构建 Web Control。单独构建：

```bash
pnpm build:native
pnpm build:core
pnpm build:web
```

## 打包与部署

```bash
pnpm package:core            # system-runtime：依赖宿主机 Node
pnpm package:core:bundled    # bundled-runtime：包内自带参考 Node
```

产物写入 `out/`，文件名含版本、提交、构建时刻与 Diretta 变体：

```text
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-{system,bundled}-linux-x64.tar.gz
```

Diretta 正式构建需显式提供受支持的 Host SDK（变体 `v2` / `v3` / `v4` / `zen4` 按目标 CPU 选最高代次）：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --diretta-variant=v2
```

归档**顶层就是安装根**，解包到目标目录即可（不需要 `--strip-components`）。产物内的 `service/` 并列两套服务定义：`install-systemd.sh`（systemd 目标机）与 `install-openrc.sh`（GentooPlayer 等 OpenRC 目标机）。数据目录、升级与回滚流程见 [Core 部署与升级](./docs/core-deployment.md)；OpenRC 侧见 [GentooPlayer（OpenRC）服务管理](./docs/gentooplayer-openrc.md)。

## 文档

- [使用指南](./docs/guide.md)
- [Core 部署与升级](./docs/core-deployment.md)（systemd、数据目录、升级、回滚）
- [GentooPlayer（OpenRC）服务管理](./docs/gentooplayer-openrc.md)（OpenRC 服务开发、部署、升级与排障）
- [构建与打包](./docs/build-and-packaging.md) · [构建面](./docs/build-flavors.md) · [CPU 变体](./docs/cpu-variants.md)
- [开发环境](./docs/atom-development.md) · [路线图](./docs/atom-roadmap.md) · [已完成事项](./docs/atom-completed.md)
- [原生模块](./docs/native.md) · [Qobuz / TIDAL Rust 协议引擎](./docs/streaming-rust-guide.md)
- [插件开发](./docs/plugins/) · [插件使用](./docs/plugins-usage.md) · [类型参考](./docs/types.md)
- [硬件发布验收](./docs/hardware-release-checklist.md) · [在线服务验收](./docs/live-provider-acceptance.md)

英文文档在 [`docs/en/`](./docs/en/)；文档站源码在 [`docs/`](./docs)，`pnpm docs:dev` 可本地预览。

## License

GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).
