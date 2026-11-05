# SPlayer Atom 构建面（Build Flavors）

> 最后更新：2026-11-05

SPlayer Atom 的 Core 构建由三条**独立维度**组合：

- **Runtime Flavor**：`node`（默认正式基线）或 `bun`（实验性）。
- **部署方式**：`system-runtime`（系统提供选定运行时）或 `bundled-runtime`（打包运行时）。
- **音频能力 / CPU**：不带 Diretta，或带 SDK 148 并指定 `v2` / `v3` / `v4` / `zen4`。

Node/Bun 使用同一份 Core JS、Web、native addons、协议和数据 schema，以及同一套构建、
staging、artifact smoke 与 `bin/splayer-atom-core` 启动入口；不是维护两个 Core 版本。
`mise.toml` 固定构建 Node `24.22.2` 和可选 Bun `1.4.4`（`mise install`）。

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

## Runtime × 部署方式

| Runtime      | system-runtime          | bundled-runtime                 |
| ------------ | ----------------------- | ------------------------------- |
| Node（默认） | `pnpm package:core`     | `pnpm package:core:bundled`     |
| Bun（实验）  | `pnpm package:core:bun` | `pnpm package:core:bun:bundled` |

打包统一走 `scripts/atom/build-core-system.ts`，支持 `--runtime=node|bun`
与 `--bundle-runtime`；旧参数 `--bundle-node` 仍用于 Node bundled。
需要指定 Bun 路径时设置 `ATOM_BUN_BIN`。构建进程必须使用 Node `24.22.2`，
但 Bun 包实际运行的是 Bun 而不是 Node。

## system-runtime

```bash
pnpm package:core
```

Node 产出 `splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz`；
Bun 在 `-system` 前增加 `-bun`，其余命名相同。

Node system-runtime 在**运行**时要求 Node `>=22.19.0`；
Bun system-runtime 要求目标机有可用的 Bun（本项目测试版本 `1.4.4`）。
这是**运行**要求，与所有 Flavor 的打包进程必须使用 Node `24.22.2` 不同。

## bundled-runtime

```bash
pnpm package:core:bundled
```

Node bundled 携带 `runtime/bin/node`；Bun bundled 携带 `runtime/bin/bun`，
Bun 产物在 `-bundled` 前增加 `-bun`。两者都不要求目标机另装对应运行时。
`runtime.json` 记录 `runtime.name/version/pluginHost`、`nodeBundled`、`bunBundled`；
Bun 产物还带有 `runtime/bun` 标记，供共用启动器选用正确运行时。

Bun 的空库 API 基准、独立 plugin Host 及安全限制记录在
[Node/Bun 运行时对照](./history/bun-runtime-experiment.md)。Bun 插件 Host 的 VM Context
不是恶意插件安全沙箱；Bun 包尚需真实硬件、长期播放、插件、发行版与升级验收，
当前不应视为正式发布物。公开分发 Bun bundled 包前需审核其许可证和静态链接组件义务。
