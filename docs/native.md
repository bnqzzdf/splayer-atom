# 原生模块

> 最后更新：2026-09-20

SPlayer Atom 的原生运行时只服务于 Linux x86-64 Node Core。

## 模块

| 模块                       | 职责                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `native/audio-engine`      | N-API 音频入口，Core 通过它访问 ALSA 与可选 Diretta Source Direct      |
| `native/audio-engine-core` | 共享 Rust 音频引擎：解码、普通播放、Direct PCM/DSD、CUE/SACD、DSP 基础 |
| `native/streaming-api`     | Qobuz / TIDAL 唯一 native protocol engine                              |
| `native/diretta-sys`       | Diretta Host SDK FFI，正式 SDK 外置                                    |

Core 构建生成两个自研 addon：

```text
audio-engine.node
streaming-api.node
```

发布包另外包含 `better-sqlite3` 等必需的第三方原生依赖。

## 构建

```bash
pnpm build:native
pnpm build:native --dev
```

正式 Core native flavor 使用 `core-audio`，Linux 输出后端为 ALSA。构建脚本会用 `ldd` 检查 `audio-engine.node`，禁止正式 Core artifact 携带 PipeWire/PulseAudio 动态依赖。

## audio-engine-core

`audio-engine-core` 是纯 Rust 共享实现。普通 ALSA 播放可使用内部处理链；Diretta 使用独立 strict Source Direct 路径，不得经过普通 `f32` DSP/resampler。

### CUE / SACD

- CUE 虚拟分轨由 Core 持有开始/结束边界；
- SACD stereo 虚拟分轨由 Core/native 协作解析；
- UPnP 所需临时 extraction/materialization 与普通/Direct 播放隔离。

## Diretta

Diretta feature 只有在 `DIRETTA_SDK_ROOT` 存在时构建。正式 artifact 使用 `--require-diretta` 强制 SDK provenance gate。

Source Direct 规则见根目录 `AGENTS.md`。

## 测试

```bash
cargo check --workspace
cargo test --workspace
pnpm test:native
```

真实 ALSA、Diretta Target、Native DSD 与 UPnP 行为需要额外硬件验收，不能由单元测试替代。
