# SPlayer Atom 构建与打包

本文描述当前唯一正式产品：**Linux x86-64 Node Core + Web Control**。

## 构建面

| 目标        | 命令                | 输出                                                 |
| ----------- | ------------------- | ---------------------------------------------------- |
| Native      | `pnpm build:native` | `out/native/audio-engine.node`, `streaming-api.node` |
| Node Core   | `pnpm build:core`   | `out/core/`                                          |
| Web Control | `pnpm build:web`    | `out/renderer/`                                      |
| 全量        | `pnpm build`        | 上述全部                                             |

## 环境

- Linux x86-64
- Node `>=22.19.0`，正式构建与 bundled-runtime reference 仍为 `24.18.0`
- pnpm `>=10`
- Rust stable
- ALSA headers、Clang、pkg-config、libarchive-tools

## 完整构建

```bash
pnpm build
```

顺序为：native → Node/Web typecheck → Core bundle → Web bundle。

## Core package

system-runtime：

```bash
pnpm package:core
```

bundled-runtime：

```bash
pnpm package:core:bundled
```

输出：

```text
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>-system-linux-x64.tar.gz
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz
```

版本号来自 `package.json`，日期与时刻为打包当时的 `YYYYMMDD-HHMMSS`。需要**内容**可重复构建时可以通过 `ATOM_BUILD_DATE=YYYYMMDD` 固定日期；需要连文件名也复现时再设置 `ATOM_BUILD_TIME=HHMMSS`。`runtime.json` 只记录可读的 `buildDate`（日期），因此仅固定 `ATOM_BUILD_DATE` 即可复现出相同字节的产物。

`<commit>` 是 8 位短提交号（取自 `git rev-parse HEAD`，或源码交付包内 `SOURCE_COMMIT` 的 `commit=`），与 `runtime.json.atomCommit` 以及 Web Control「关于软件」页显示的提交号完全一致——**拿到一个 tar 就能知道它出自哪次提交，不必解包读 `runtime.json`**。

staging 内容包括 Core JS、Web Control、两个自研 native addons、`better-sqlite3` 等运行依赖、`runtime.json`、LICENSE、systemd unit、启动脚本和部署文档。

## runtime.json

发布身份只记录 Atom 自身与运行契约，包括：

- `productName`
- `atomVersion`
- `buildDate`
- `atomCommit`
- `sourceDirty`
- platform / arch
- Node range/reference/bundled 状态
- Core protocol version
- data schema versions
- capabilities
- Diretta SDK release（仅 Diretta build）

正式 release 应从 clean worktree 构建，因此 `sourceDirty=false`。

## Diretta

普通 Core build 不要求专有 SDK。正式 Diretta artifact 必须：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v2
```

SDK release 必须匹配仓库固定版本；缺失或不匹配会在 staging 前失败。SDK 本体不进入 artifact。

## Debian 11 bundled package

Debian 11 构建在容器内使用 glibc 2.31。默认不包含 Diretta：

```bash
pnpm package:core:debian11 --without-diretta
```

包含 Diretta 时，提供 SDK 150 路径并选择目标 CPU 变体：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

`v2`、`v3`、`v4`、`zen4` 对应 SDK 的 x86-64 库变体——变体决定产物**能不能在目标 CPU 上跑**，不只是快慢，详见 [CPU 变体](/cpu-variants)。构建时只读挂载 SDK，不把 SDK 文件放入产物。脚本会检查 native addon 的 glibc 版本、Diretta 能力位和产物启动。两种模式分别保留为
`out/*-debian11-without-diretta.tar.gz` 和 `out/*-debian11-with-diretta-<variant>.tar.gz`。
Diretta SDK 150 的 ACQUA 库在旧 glibc 上所需的整数解析符号由本仓库兼容层提供。

容器本身（Dockerfile + 容器内构建脚本 + 缓存卷说明）在 [`docker/atom-debian11/`](../docker/atom-debian11/README.md)。

## Artifact smoke

`scripts/atom/build-core-system.ts` 在正式构建链中会执行 staging 与最终 artifact 检查。检查包含：

- runtime metadata
- native addon load
- plugin-host IPC
- Core `/api/info`、session、library、cache
- Web 根页
- startup / SIGTERM
- bundled-runtime 是否真正使用包内 Node

## CI

`.github/workflows/dev.yml` 在 `ubuntu-24.04` Linux x86-64 环境中使用 Node `24.18.0`
与 Rust stable 构建 Core/Web。Debian 11 容器是单独的打包环境；发布时应记录实际使用的构建环境、源码提交与产物 hash。

## 发布前门禁

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm package:core
pnpm docs:build
cargo check --workspace
cargo test --workspace
git diff --check
```

硬件验收另见 [hardware-release-checklist.md](./hardware-release-checklist.md)。
