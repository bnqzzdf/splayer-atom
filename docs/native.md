# 原生模块

SPlayer Atom 将音频、流媒体协议和平台集成中的原生能力集中在 **Rust**。对 Node/Electron 暴露的模块通过 [NAPI-RS](https://napi.rs/) 编译为 `.node`；共享音频实现则位于纯 Rust `audio-engine-core` 中。所有原生模块都位于仓库的 `native/` 目录。

## 模块一览

| 模块                | 职责                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `audio-engine-core` | 共享 PCM/DSD decode、cpal 普通输出、DSP、CUE/SACD、strict Source Direct 与 Diretta runtime |
| `audio-engine`      | `audio-engine-core` 的 N-API 入口；Desktop/Core 都通过它加载音频能力                       |
| `streaming-api`     | Atom 唯一 Qobuz/TIDAL Rust 协议实现                                                        |
| `audio-capture`     | Windows/Linux 音频捕获相关原生能力                                                         |
| `media-ctrl`        | 系统媒体控制（Windows SMTC / Linux MPRIS / macOS Now Playing）与 Discord RPC               |
| `taskbar-lyric`     | Windows 任务栏歌词文字渲染                                                                 |
| `taskbar-thumbnail` | Windows 任务栏悬停缩略图 / Peek 预览替换为专辑封面                                         |
| `opencc`            | OpenCC 原生能力                                                                            |

### audio-engine-core / audio-engine

共享音频引擎负责解码、普通输出和 strict Direct：

- 使用 `ffmpeg_audio` crate 进行解码，支持 MP3、FLAC、WAV、AAC、OGG、APE 等格式；
- 普通 Desktop 输出基于 cpal，支持 Linux PipeWire/PulseAudio、macOS CoreAudio、Windows WASAPI；
- 普通输出支持渐入渐出、变速变调、normalization、EQ/preamp 与 FFT；
- Core `core-audio` flavor 在 Linux 使用 ALSA-only native surface，不启用 Desktop PipeWire/PulseAudio feature set；
- Diretta strict Source Direct 走独立 Direct runtime，PCM/Native DSD 不进入普通 float DSP 路径；
- CUE 虚拟分轨、SACD stereo 虚拟分轨与相关 decode/extract 能力由共享 Core 实现；
- 实时 FFT 频谱数据，驱动可视化与歌词律动；
- 解码时同步提取封面缩略图；
- 在线音源通过 `ffmpeg_audio::HttpAudioSource`（配合 `HttpCancelHandle` 实现打断与 Seek 状态重置，基于 `reqwest` + `rustls`）以 `Read + Seek` 方式按需拉取，TLS 在 Rust 内处理，跨平台且无系统依赖。

`audio-engine` 只负责把这些能力暴露给 Node/Electron，不维护第二套播放器实现。

### streaming-api

Qobuz 与 TIDAL 的协议、签名/auth/manifest 等协议实现只保留在 `streaming-api` Rust 模块中。Node Core 管理 session/policy，并通过 N-API 调用该唯一实现。

### media-ctrl

跨平台的系统媒体集成：

- Windows SMTC、Linux MPRIS、macOS Now Playing；
- Discord Rich Presence（播放状态展示）。

### taskbar-lyric

Windows 任务栏歌词渲染，跟随系统主题与任务栏状态自适应。

### taskbar-thumbnail

Windows 任务栏缩略图自定义（仅 Windows）：

- 借助 DWM 的 iconic representation，把任务栏**悬停缩略图**与 **Peek 全尺寸预览**替换为指定图片（当前专辑封面），而非默认的实时窗口内容；
- 对主窗口子类化，被动应答 DWM 的位图请求，封面变化时通知 DWM 重新拉取。

## 构建

构建原生模块需要 **Rust 工具链**（通过 [rustup](https://rustup.rs/) 安装）。

`pnpm dev` 与 `pnpm build` 会自动编译原生模块，通常无需手动操作：

```bash
# 仅构建原生模块（release）
pnpm build:native

# 构建 debug 版本（更快，便于调试）
pnpm build:native --dev
```

Core artifact 不直接使用上面的 Desktop native flavor，而是通过：

```bash
pnpm exec tsx scripts/atom/build-core-native.ts
```

只生成 `audio-engine.node` 与 `streaming-api.node`。完整 Core 打包应使用 `scripts/atom/build-core-system.ts`，不要把单独的 native 输出当作正式 artifact。详细构建/打包和 Linux glibc 规则见 [`build-and-packaging.md`](./build-and-packaging.md)。

NAPI-RS 会自动生成各模块的 `index.d.ts` 类型声明，主进程通过路径别名引用：

```
@splayer/audio-engine      → native/audio-engine
@splayer/media-ctrl        → native/media-ctrl
@splayer/taskbar-lyric     → native/taskbar-lyric
@splayer/taskbar-thumbnail → native/taskbar-thumbnail
```

::: tip 跳过原生构建
如果当前只做界面（渲染层）开发、不需要原生能力，可设置环境变量 `SKIP_NATIVE_BUILD=true` 跳过 Rust 编译，加快启动：

```bash
SKIP_NATIVE_BUILD=true pnpm dev
```

:::

::: warning 请勿手改类型声明
`native/*/index.d.ts` 由 NAPI-RS 自动生成，请勿手动编辑——主进程类型应从 `@splayer/*` 导入，而非自行声明。
:::

::: warning Linux glibc 下限由最终 ELF 决定
Linux 本地构建可能继承构建机更高版本的 glibc symbol requirement。正式 Linux artifact 应在固定 builder/sysroot 中构建，并扫描最终 `.node`/Electron/Node/其他 ELF 的最高 `GLIBC_x.y`。参见 [`build-and-packaging.md`](./build-and-packaging.md)。
:::
