<div align="center">

<img alt="SPlayer Atom logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>SPlayer Atom</h2>

<p>🎵 基于 SPlayer-Next 的持续下游版本，聚焦 Core-first 架构、统一 Desktop/Web Control、在线无损服务与 strict HiFi Source Direct</p>

<p>持续跟进官方 <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> 基线</p>

[![Stars](https://img.shields.io/github/stars/bnqzzdf/splayer-atom?style=flat)](https://github.com/bnqzzdf/splayer-atom/stargazers)
[![Release](https://img.shields.io/github/v/release/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/releases)
[![License](https://img.shields.io/github/license/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/issues)

[English](./README.md) | **简体中文**

</div>

---

> **SPlayer Atom 下游说明：** 本仓库是 SPlayer-Next 的下游发行版。SPlayer-Next 仍是正式基础，上游版权与 AGPL-3.0 许可声明保持不变。Atom 只维护已经确认的最小产品差异，并持续集成官方 SPlayer 更新，而不是演化成第二套独立播放器栈。

## 为什么是 SPlayer Atom？

SPlayer Atom 保留 SPlayer-Next 的 Desktop 体验、媒体模型、队列、曲库、歌词、UI 与通用播放基础，只在需要不同 ownership 或更严格 HiFi 保证的地方增加少量明确能力。

| 领域     | SPlayer-Next 基础                        | SPlayer Atom 增量                                                                                         |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 产品模型 | 完整 Desktop 播放器                      | 增加普通 **Node Core**，统一持有音乐业务状态并可 Headless 运行                                            |
| Control  | Desktop renderer                         | 同一套 Vue 界面既可作为 **Desktop Control**，也可作为 **Web Control** 连接同一个 Core 协议                |
| 播放权威 | Desktop-oriented playback lifecycle      | Core 持有 canonical queue、播放策略、source resolution、cache、preload/recovery、统计与 output assignment |
| 在线音乐 | SPlayer 现有服务与 Netease compatibility | 增加 **Qobuz**、**TIDAL**，协议唯一实现为 Rust `streaming-api`                                            |
| Scrobble | SPlayer 已有 Last.fm 等集成              | 增加 **ListenBrainz Core Scrobble / Now Playing**；I/O 与音频链隔离，关闭时零 runtime                     |
| 音频输出 | SPlayer 通用音频引擎与效果链             | 在普通 ALSA 之外增加 **Diretta strict Source Direct**，Direct 不进入普通 float DSP 路径                   |
| 部署     | Desktop 应用                             | 增加 Linux x86-64 Core artifact、Web Control、systemd、迁移/备份/回滚与明确 runtime capability metadata   |

Atom 刻意不建立第二套媒体模型、队列、provider framework 或音频引擎。QQ Music / Kugou 只保留官方 SPlayer 冻结兼容面，不作为 Atom 主动扩展的产品路线。

## HiFi 与 Diretta Source Direct

Atom 的 Diretta 不是把另一个 output backend 挂到 SPlayer 普通 DSP pipeline 后面。选择 `diretta:*` 输出会进入独立 strict Direct runtime，并采用 fail-closed 原则：Target 如果不能接受与源等价的精确格式，就明确失败，而不是静默重采样或退回 processed path。

### Direct 保持什么

- **PCM：** 保持源 sample rate、channel count，以及每一个有效整数 PCM sample bit/value。24-bit PCM 只允许在有效 24 bit 完全不变的前提下装入 32-bit transport slot。
- **Native DSD：** 保持 logical one-bit sequence、DSD rate 与 channel count。DSF/DFF layout repack 和逐字节 bit reverse 只用于无损的 container/wire-order 适配。
- **禁止改变 sample：** 不允许 resampling、remix、ReplayGain/normalization、EQ/preamp、低于 unity 的软件音量、fade、tempo、pitch、re-encoding、PCM fallback、DoP 或 DSD-to-PCM。

播放器会在进入 Direct 前检查这些条件；进入后任何会改变 sample 的控制都会被拒绝，直到退出 Direct 模式。

### 内存与拷贝模型

Source Direct 追求的是最短且安全的数据路径，但**不宣传为全链路零拷贝，也不是 whole-track RAM 播放**：

- FFmpeg 已经给出 packed `S16` / `S32` 时，从 decoded frame 经过 Direct ring 到 Diretta SDK callback 走 **zero-copy fast path**；
- planar PCM 会写入预分配 integer buffer，进行 **bit-perfect repack / interleave**；
- Native DSD 使用预分配 buffer 做 DSF/DFF layout adaptation；只有 Target wire-order 需要时才做等价 bit-order conversion；
- Diretta SDK realtime pull callback 只借用已经准备好的 payload pointer + length，不在 callback 内复制或处理 audio sample；
- HTTP(S) Direct 音源按响应 exact bytes materialize 成本地 seekable 临时文件，不把整首歌先塞进 RAM。

因此这里真正坚持的是：**源数据已经满足 transport layout 时绝不多碰；必须适配时，只做不改变音频语义的最小 repack。**

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
                         Core Local Output
                         ├─ ALSA
                         └─ Diretta Source Direct
```

Web 与 Desktop 都只是 Control，不成为第二个 domain authority。Desktop 独有的窗口、托盘、热键、updater、本机文件、protocol 与歌词窗口继续作为 Host Capability；音乐业务命令与 snapshot 则统一使用 Core contract。

## 继承自 SPlayer-Next 的能力

Atom 继续直接受益于 SPlayer 的完整基础，包括：

- 🎵 **广泛格式支持** —— MP3、FLAC、WAV、AAC、OGG、APE 等，基于 FFmpeg + Rust
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

pnpm build:win     # 打包 Windows
pnpm build:mac     # 打包 macOS
pnpm build:linux   # 打包 Linux（AppImage / deb / rpm / tar.gz / pacman）
```

> 默认仅构建当前架构，暂不支持交叉编译。

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

特别感谢以下让 SPlayer-Next 成为可能的开源项目：

- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) —— 类 Apple Music 歌词显示组件库
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) —— 网易云音乐 API 备份 + 增强

## 开源许可

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可开源。

- **修改与分发：** 任何修改或分发都必须同样基于 **AGPL-3.0**，并一并提供完整源代码。
- **派生作品：** 必须同样采用 **AGPL-3.0**，并在适当位置保留本项目的许可与版权信息。
- **署名：** 必须保留原作者及版权信息。可为二次开发添加你自己的署名，但不得移除或篡改原始信息。
- **商业用途：** 如用于售卖或其他盈利用途，必须提供源代码及原项目链接。由于本项目涉及第三方服务，商业使用可能存在法律风险。
- **免责：** 本软件按「现状」提供，不附带任何形式的担保，详见 AGPL-3.0。

## 免责声明

本项目仅供个人学习与研究使用，禁止用于商业及非法用途。部分功能依赖第三方 API，使用者须自行确保其使用符合相关法律法规及服务协议。对于因使用本项目而产生的任何直接或间接后果，作者不承担任何责任。
