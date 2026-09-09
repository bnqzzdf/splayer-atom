# SPlayer Atom 构建与打包

本文描述当前唯一正式产品：**Linux x86-64 Node Core + Web Control**。

## 构建面

| 目标        | 命令                | 输出                                                 |
| ----------- | ------------------- | ---------------------------------------------------- |
| Native      | `pnpm build:native` | `out/native/audio-engine.node`, `streaming-api.node` |
| Node Core   | `pnpm build:core`   | `out/core/`                                          |
| Web Control | `pnpm build:web`    | `out/renderer/`                                      |
| 全量        | `pnpm build`        | 上述全部                                             |

项目没有 Electron build、Windows/macOS build 或 Desktop package target。

## 环境

- Linux x86-64
- Node `>=24.18.0 <25`，正式 reference 为 `24.18.0`
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
dist/splayer-atom-core-system-linux-x64.tar.gz
dist/splayer-atom-core-bundled-linux-x64.tar.gz
```

staging 内容包括 Core JS、Web Control、两个 native addons、`runtime.json`、LICENSE、systemd unit、启动脚本和部署文档。

## runtime.json

发布身份只记录 Atom 自身与运行契约，包括：

- `productName`
- `atomVersion`
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
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

SDK release 必须匹配仓库固定版本；缺失或不匹配会在 staging 前失败。SDK 本体不进入 artifact。

## Linux glibc ABI

Rust/N-API 与 bundled Node 都是 ELF。构建机较新的 glibc 可能让最终 artifact 引用更高版本的 `GLIBC_x.y`，从而无法在旧系统运行。

正式发布规则：

1. 使用固定的 Linux x86-64 builder/sysroot；
2. builder 的 glibc 不高于计划支持的最低版本；
3. 对最终解包 artifact 中所有 ELF 扫描版本化 glibc 符号；
4. 以整个 artifact 的最高要求作为真实最低 glibc 版本。

示例扫描：

```bash
find core-system -type f -print0 |
while IFS= read -r -d '' f; do
  max=$(objdump -T "$f" 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -1)
  [ -n "$max" ] && printf '%-15s %s\n' "$max" "$f"
done
```

不要把 glibc 2.43 的日常开发机直接作为公开 release builder。

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

`.github/workflows/dev.yml` 只在 `ubuntu-latest` 构建 Linux x86-64 Core/Web，使用 Node `24.18.0` 与 Rust stable，不再存在 Desktop matrix。

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
