# SPlayer Atom 构建面（Build Flavors）

> 最后更新：2026-09-28

SPlayer Atom 有两个部署变体：system-runtime 与 bundled-runtime。

## Core native 构建面

Linux x86-64 Core 构建产出两个自研 native addon：

- `audio-engine.node`
- `streaming-api.node`

必需的第三方 native 依赖（含 `better-sqlite3`）单独打包。

音频 addon 在 ALSA 下使用 `core-audio` feature 集。构建会在正式产物中拒绝 PipeWire/PulseAudio
动态依赖。

流媒体 addon 使用 Rustls 与系统 CA 证书，且不得动态依赖
OpenSSL（`libssl.so` 或 `libcrypto.so`）。目标系统仍需有可用的 CA 证书库，
供 HTTPS provider 请求使用。

## Diretta 能力

没有 `DIRETTA_SDK_ROOT` 时，Core 构建不带 Diretta。

在有受支持的 `DIRETTA_SDK_ROOT` 时，`audio-engine` 会增加 `diretta` feature。正式 Diretta 产物必须使用：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v2
```

`--diretta-variant` 选择 x86-64 Host SDK 库变体（`v2`、`v3`、`v4` 或 `zen4`）。变体决定产物究竟能不能在目标 CPU 上运行，而不只是快慢。选定的变体会传给 native Cargo 构建，并记录在产物元数据中。Diretta 构建必须显式指定它，不会静默默认为 `v2`。

SDK 始终是外部的，不随包捆绑。

## Debian 11 bundled 构建

Debian 11 构建机使用 glibc 2.31，两种能力集都能打包：

```bash
pnpm package:core:debian11 --without-diretta

DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_148 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

第一种模式是默认模式。第二种模式只读挂载 SDK 148，并使用其选定的
`v2`、`v3`、`v4` 或 `zen4` x86-64 库。构建会按 glibc
2.31 检查打包后的 native 模块、检查 Diretta 能力元数据，并运行解包产物的 smoke。SDK 148 的
ACQUA 库在链接时获得旧 glibc 所需的整数解析兼容符号；
SDK 文件不会被打包。各模式的副本分别保留为
`*-debian11-without-diretta.tar.gz` 与 `*-debian11-with-diretta-<variant>.tar.gz`。

2026-09-23，无 Diretta 与 Diretta v3 包在脏工作树上通过了软件 smoke。
这不能确立干净的发布产物，也不代表 Diretta Target 播放；该次运行没有构建 v2/v4。

## system-runtime

```bash
pnpm package:core
```

产出 `splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz`。

该产物在**运行**时要求系统 Node 满足 `>=22.19.0`（`core/atom/runtime/nodeRuntime.ts:2`）。这与**构建**要求不同：打包任何 flavor 都要求构建进程的 Node **恰好为 `24.18.0`**（`scripts/atom/build-core-system.ts:34`、`scripts/atom/stage-core-system.ts:88`）。

## bundled-runtime

```bash
pnpm package:core:bundled
```

产出 `splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz`，并携带构建时使用的 reference Node runtime。

两个变体包含相同的 Core JS、Web Control、native addons、协议版本与数据 schema。
