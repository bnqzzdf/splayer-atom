<div align="center">

<img alt="SPlayer Atom logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>SPlayer Atom</h2>

<p>🎵 SPlayer-Next 的独立下游发行版，聚焦 Core-first 架构、统一 Desktop/Web Control、在线无损服务与 strict HiFi Source Direct</p>

<p>持续跟进官方 <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> 基线</p>

[![Stars](https://img.shields.io/github/stars/bnqzzdf/splayer-atom?style=flat)](https://github.com/bnqzzdf/splayer-atom/stargazers)
[![Release](https://img.shields.io/github/v/release/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/releases)
[![License](https://img.shields.io/github/license/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/issues)

[English](./README.md) | **简体中文**

</div>

---

> **SPlayer Atom 下游说明：** SPlayer Atom 是基于 SPlayer-Next 持续开发的独立下游发行版，不是 SPlayer-Next 本身，也不代表上游项目。SPlayer-Next 是 Atom 的正式上游；上游版权与 AGPL-3.0 许可声明保持不变。Atom 以自己的 Core / Control / Output 产品架构、HiFi 实现和发布节奏持续维护，同时尽量控制相对上游的长期差异。

## 为什么是 SPlayer Atom？

SPlayer Atom 从 SPlayer-Next 继承成熟的 Desktop、媒体、歌词、曲库与 UI 基础，并在此之上形成自己的 Core-first 产品架构、Headless/Web Control、在线服务和 strict Source Direct 音频路径。Atom 是一个持续跟进上游的下游产品，而不是把 README、品牌或发布身份继续视为 SPlayer-Next。

| 领域     | SPlayer-Next 基础                        | SPlayer Atom 增量                                                                                                 |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 产品模型 | 完整 Desktop 播放器                      | 增加普通 **Node Core**，统一持有音乐业务状态并可 Headless 运行                                                    |
| Control  | Desktop renderer                         | 同一套 Vue 界面既可作为 **Desktop Control**，也可作为 **Web Control** 连接同一个 Core 协议                        |
| 播放权威 | Desktop-oriented playback lifecycle      | Core 持有 canonical queue、播放策略、source resolution、cache、preload/recovery、统计与 output assignment         |
| 在线音乐 | SPlayer 现有服务与 Netease compatibility | 增加 **Qobuz**、**TIDAL**，协议唯一实现为 Rust `streaming-api`                                                    |
| Scrobble | SPlayer 已有 Last.fm 等集成              | 增加 **ListenBrainz Core Scrobble / Now Playing**；I/O 与音频链隔离，关闭时零 runtime                             |
| 音频输出 | SPlayer 通用音频引擎与效果链             | 增加 **Diretta strict Source Direct** 与 Core-owned **UPnP MediaRenderer** 输出；Direct 不进入普通 float DSP 路径 |
| 分轨媒体 | 常规本地文件 / CUE 基础能力              | Core 统一处理 CUE 虚拟分轨、SACD stereo 虚拟分轨、分轨结束边界与 UPnP 离线物化                                    |
| 部署     | Desktop 应用                             | 增加 Linux x86-64 Core artifact、Web Control、systemd、迁移/备份/回滚与明确 runtime capability metadata           |

Atom 刻意不建立第二套媒体模型、队列、provider framework 或音频引擎。QQ Music / Kugou 只保留官方 SPlayer 冻结兼容面，不作为 Atom 主动扩展的产品路线。

## HiFi 与 Diretta Source Direct

Atom 的 Diretta 不是把另一个 output backend 挂到 SPlayer 普通 DSP pipeline 后面。选择 `diretta:*` 输出会进入独立 strict Direct runtime，并采用 fail-closed 原则：Target 如果不能接受与源等价的精确格式，就明确失败，而不是静默重采样或退回 processed path。

### Direct 保持什么

- **PCM：** 保持源 sample rate、channel count，以及每一个有效整数 PCM sample bit/value。24-bit PCM 只允许在有效 24 bit 完全不变的前提下装入 32-bit transport slot。
- **Native DSD：** 保持 logical one-bit sequence、DSD rate 与 channel count。DSF/DFF layout repack 和逐字节 bit reverse 只用于无损的 container/wire-order 适配。
- **禁止改变 sample：** 不允许 resampling、remix、ReplayGain/normalization、EQ/preamp、低于 unity 的软件音量、fade、tempo、pitch、re-encoding、PCM fallback、DoP 或 DSD-to-PCM。

播放器会在进入 Direct 前检查这些条件；进入后任何会改变 sample 的控制都会被拒绝，直到退出 Direct 模式。

### 音质依据

Atom 对 Source Direct 的 HiFi 声明只建立在可验证的数字信号事实之上：**是否改变 sample value / logical DSD bit sequence、sample rate、channel count，以及是否发生 DSP、重采样或格式回退。**

内存驻留、减少内存复制、降低 CPU 或 I/O 活动可以是性能、实时性和稳定性方面的工程优化，但 Atom **不把“纯内存播放”“零拷贝”或更少数据复制宣传为音质提升来源**。只要数字样本保持完全一致且没有 underrun/dropout，数据来自文件缓存还是 RAM、在软件中是否发生一次正确的无损复制，本身不构成音质更好的依据。

因此 strict Direct 的目标不是追求某种“更纯”的内存路径，而是确保任何必要的 decode、layout adaptation 或 transport repack 都不改变最终音频内容；不需要改变音频内容的 DSP 则完全绕开。

### 实机验证

当前 Diretta PCM 与 Native DSD 路径均已通过真实硬件 bit-perfect 验证。PCM 已实机覆盖到 768 kHz，其下实际支持的 sample-rate 档位也均已验证；Native DSD 已实机覆盖到 DSD512，其下实际支持的 DSD rate 档位也均已验证。PCM 播放时源数据/格式与 `/proc/asound/card0/stream0` 暴露的当前 USB Audio stream 状态以及 DAC 显示一致；Native DSD Source Direct 在真实播放链路保持 logical one-bit sequence 不变。PCM/DSD 混合格式队列也已经完成过夜循环长时间播放，未观察到播放或 format transition 异常。当前剩余硬件工作主要是面向正式发布的 lifecycle 与最终 artifact 复验，分别记录在 [`docs/atom-roadmap.md`](./docs/atom-roadmap.md) 与 [`docs/hardware-release-checklist.md`](./docs/hardware-release-checklist.md)。

## Core / Control / Output

```text
                   Desktop Control
                         │
                         │ Core Control Protocol
                         ▼
Web Control ───────► Node Core
                    ├─ database / settings / library
                    ├─ provider sessions / canonical queue
                    ├─ source resolution / cache / preload / recovery
                    ├─ ListenBrainz session authority
                    └─ output assignment / Diretta materialization
                              │
                              ▼
                         Core Output
                         ├─ ALSA
                         ├─ Diretta Source Direct
                         └─ UPnP MediaRenderer
```

Web 与 Desktop 都只是 Control，不成为第二个 domain authority。Desktop 独有的窗口、托盘、热键、updater、本机文件、protocol 与歌词窗口继续作为 Host Capability；音乐业务命令与 snapshot 则统一使用 Core contract。

## 来自上游 SPlayer-Next 的基础能力

作为 SPlayer-Next 的下游发行版，Atom 直接继承并持续整合上游的大量成熟能力，包括：

- 🎵 **广泛格式支持** —— MP3、FLAC、WAV、AAC、OGG、APE 等，基于 FFmpeg + Rust
- 💿 **虚拟分轨** —— CUE 与 SACD stereo area 可展开为稳定虚拟曲目；CUE 的开始/结束边界由 Core 播放生命周期统一处理
- 📝 **丰富歌词** —— LRC / QRC / YRC / TTML、逐字高亮、翻译与原生歌词窗口
- 🌐 **媒体服务器** —— Subsonic / Navidrome / Jellyfin / Emby
- 🖥️ **Desktop 支持** —— Windows / macOS / Linux
- 🎚️ **普通输出音频功能** —— Source Direct 之外继续支持 FFT、normalization、EQ、speed/pitch 与 fade
- 🏷️ **曲库与元信息** —— 本地扫描、标签/封面编辑、歌单、cache 与下载
- 🎧 **系统媒体集成** —— Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- 🎨 **自适应 UI** —— 封面取色、Light / Dark / Auto，以及上游 SPlayer 界面体验

## 在线服务

- **Netease** 延续 SPlayer 既有 TypeScript compatibility，并接入 Atom Core ownership seam。
- **Qobuz** 与 **TIDAL** 只使用唯一 Rust `streaming-api` 协议实现；Core 持有 credential/session policy，Control 只消费 projection。
- **ListenBrainz** Scrobble / Now Playing 由 Core 持有。关闭时不创建 child process、数据库句柄、HTTP client、retry timer 或高频 listener；启用后 durable outbox 与网络 I/O 都在独立 child process 中运行，不阻塞音频路径。
- **QQ Music / Kugou** 仅保留冻结的上游兼容面，不扩展为 Atom 专属 provider 产品。

真实账号验收状态以 roadmap 为准，README 不把尚未完成的 live acceptance 写成已完成能力。

## 开发

### 环境要求

- **Desktop 开发：** Node.js `>=22.19.0`（与 package engine 约束一致）
- **正式 Node Core 构建：** Node.js `>=24.18.0 <25`；release reference runtime 为 `24.18.0`
- **pnpm** >= 10（当前 `packageManager` 固定 pnpm 11.x）
- **Rust 工具链**（构建原生模块所需，见下）

### 原生模块

原生能力由 Rust 模块提供。Desktop 继续保留上游平台模块，而 Linux Core artifact 只包含真正需要的 native runtime。

| 模块                | 职责                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `audio-engine`      | shared Rust audio engine 的 N-API 入口；Core 通过它实现 ALSA 与可选 Diretta Source Direct |
| `audio-engine-core` | PCM/DSD decode、普通播放内部实现、strict Direct runtime 与 Diretta integration            |
| `streaming-api`     | Atom 唯一 Qobuz/TIDAL native protocol implementation                                      |
| `media-ctrl`        | Desktop 系统媒体控制 + Discord Rich Presence                                              |
| `taskbar-lyric`     | Windows 任务栏歌词原生渲染                                                                |

正式 Core `core-audio` flavor 只打包 `audio-engine.node` 与 `streaming-api.node`，运行时不携带 Electron/Chromium 或 Desktop-only native 模块。

`pnpm dev` 与 `pnpm build` 会自动编译原生模块。若只做 UI 开发想跳过，可设置 `SKIP_NATIVE_BUILD=true`。

### 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发（先以 debug 构建原生模块，再启动 Electron）
pnpm dev
```

### 构建

```bash
pnpm build         # 完整构建：清理 → 原生模块 → 类型检查 → electron-vite
pnpm build:unpack  # 生成未安装/未压缩的 Electron 目录，适合本机验收和 ELF 依赖扫描

pnpm build:win     # 打包 Windows
pnpm build:mac     # 打包 macOS
pnpm build:linux   # 打包 Linux Desktop；当前只生成 tar.gz
```

> 默认仅构建当前架构，暂不支持交叉编译。

> **Linux ABI 注意：** Desktop/Core 都包含 Rust/N-API 原生产物，Linux 本地构建会继承构建环境可用的 glibc ABI。比如在滚动发行版或 glibc 2.43 主机直接构建，产物可能实际引用 `GLIBC_2.43`，从而无法在较旧系统运行。正式 Linux 发布应使用固定的较老 builder/sysroot，并在发布前扫描最终 ELF 的最高 `GLIBC_x.y` 符号版本。详见 [`docs/build-and-packaging.md`](./docs/build-and-packaging.md)。

### 构建 Node Core

普通 technical Core build 不需要专有 Diretta SDK：

```bash
pnpm exec tsx scripts/atom/build-core-system.ts
```

需要 Diretta 的正式 Core build 必须显式提供支持的外部 Host SDK，并启用 required gate：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

SDK 不进入本仓库，也不会被打进 release artifact。具体 flavor/release 规则见 [`docs/build-flavors.md`](./docs/build-flavors.md)，systemd、data、migration、upgrade 与 rollback 见 [`docs/core-deployment.md`](./docs/core-deployment.md)。

Desktop/Core 的完整构建链、平台打包目标、Diretta 构建方式、Linux glibc 兼容性与产物验收命令统一记录在 [`docs/build-and-packaging.md`](./docs/build-and-packaging.md)。

### 其他脚本

```bash
pnpm typecheck        # tsc + vue-tsc（node + web 双目标）
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # 仅构建 Rust 原生模块（加 `--dev` 为 debug 构建）
pnpm test             # Node + Web 测试
pnpm test:native      # Rust workspace 测试
```

上游同步与 Atom delta 的可审计规则见 [`docs/upstream-sync.md`](./docs/upstream-sync.md)；当前产品范围和验收缺口见 [`docs/atom-roadmap.md`](./docs/atom-roadmap.md)。

## 致谢

首先感谢 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 及其维护者与贡献者。SPlayer-Next 是 SPlayer Atom 的正式上游，Atom 的 Desktop、媒体模型、歌词、曲库、UI 与大量通用播放器基础都直接源自上游项目。Atom 作为独立下游发行版持续整合这些成果，并保留相应版权与 AGPL-3.0 许可声明。

同时感谢 SPlayer-Next 及 Atom 所依赖的开源项目，包括：

- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) —— 类 Apple Music 歌词显示组件库
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) —— 网易云音乐 API 备份 + 增强

## 开源许可

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可开源。

- **商业使用：** AGPL-3.0 本身不禁止商业使用。任何商业或非商业使用、修改、分发及通过网络向用户提供修改版本时，均应遵守 AGPL-3.0 对源代码提供、许可声明和相应网络使用场景的要求。
- **修改与派生：** 对本项目的修改或派生版本应继续遵守 AGPL-3.0，并保留适用的版权、许可与归属声明。
- **第三方组件：** Diretta、Qobuz、TIDAL 以及其他第三方服务、API、SDK、媒体或品牌受各自许可证、开发者条款和服务协议约束；本仓库的 AGPL-3.0 许可不会自动授予这些第三方内容的使用、再分发或商业授权。
- **Diretta SDK：** Diretta proprietary SDK 不属于本仓库源码，也不会随本项目作为预编译产物分发。需要相关功能的使用者应自行从权利方获得合法 SDK、凭据以及必要授权。
- **源码分发定位：** 本项目当前以源码形式维护和分发，不承诺提供预编译发布产物。
- **免责：** 本软件按「现状」提供，不附带任何形式的担保，详见 AGPL-3.0。

## 免责声明

使用、修改或分发本项目时，使用者应自行确保符合适用法律法规、AGPL-3.0，以及所使用第三方服务、API、SDK、内容与设备的许可和服务协议。本项目不提供任何第三方授权、服务可用性或合规保证。对于因使用本项目或第三方集成功能而产生的直接或间接后果，作者不承担责任，法律另有强制规定的除外。
