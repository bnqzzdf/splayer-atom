# SPlayer Atom 构建与打包

> 最后更新：2026-09-28

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
- **运行时要求**：Core 在启动时校验实际 Node runtime，最低 `>=22.19.0`（`core/atom/runtime/nodeRuntime.ts:2,35-39`）；bundled-runtime 自带 reference Node
- **构建要求**：打包任何 flavor 的 Core 产物都要求当前进程 Node **恰好为 `24.18.0`**，`system` 与 `bundled` 都不例外（`scripts/atom/build-core-system.ts:34`、`scripts/atom/stage-core-system.ts:88`、`core/atom/runtime/nodeRuntime.ts:1`）
- pnpm `>=10`
- Rust stable
- ALSA headers、Clang、pkg-config
- `libarchive-tools`：仅 CI 的依赖安装行需要（`.github/workflows/dev.yml:54`）；仓库脚本没有使用它（打包与解包都用 GNU `tar`），本地构建可以省略

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
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz
```

版本号来自 `package.json`，日期与时刻为打包当时的 `YYYYMMDD-HHMMSS`。需要**内容**可重复构建时可以通过 `ATOM_BUILD_DATE=YYYYMMDD` 固定日期；需要连文件名也复现时再设置 `ATOM_BUILD_TIME=HHMMSS`。`runtime.json` 只记录可读的 `buildDate`（日期），因此仅固定 `ATOM_BUILD_DATE` 即可复现出相同字节的产物。

`<commit>` 是 8 位短提交号（取自 `git rev-parse HEAD`，或源码交付包内 `SOURCE_COMMIT` 的 `commit=`），与 `runtime.json.atomCommit` 以及 Web Control「关于软件」页显示的提交号完全一致——**拿到一个 tar 就能知道它出自哪次提交，不必解包读 `runtime.json`**。

### 提交必须真实存在且已发布

产物名与 `runtime.json` 里的提交是「这份产物出自哪份源码」的唯一凭据，所以它必须是**真实存在**的提交：不只是长得像 SHA，还得是该仓库里真实存在的 commit 对象，并且在**网络远端**（`origin` 等 `http(s)` / `ssh` 地址）上可达。本地路径或 `file://` 的参考仓库一律不算——那种提交只存在于构建机上，别人取不到。

不满足时 staging 直接失败，不会产出带可疑提交号的包。纯源码交付包（不含 `.git`）需要在 `SOURCE_COMMIT` 里自证：

```text
commit=<sha>
dirty=false
date=<iso>
remote=https://github.com/bnqzzdf/splayer-atom.git
published=true
```

`remote` 必须是网络地址，`published=true` 才会被采信；只写 `published=true` 而 `remote` 是本地路径时按未发布处理。

只在本地做试验、明确不需要发布身份时，可以显式跳过检查：

```bash
pnpm exec tsx scripts/atom/build-core-system.ts --bundle-node --allow-unpublished
```

它**只跳过检查**，不会把身份改成已发布——这样的产物不能作为发布交付。

staging 内容包括 Core JS、Web Control、两个自研 native addons、`better-sqlite3` 等运行依赖、`runtime.json`、LICENSE、systemd unit、启动脚本和部署文档。

## 源码交付包

```bash
pnpm package:source
```

把当前**已发布提交**的纯导出打成 `out/splayer-atom-dev-<version>-<短提交号>-src-<YYYYMMDD>-<HHMMSS>.tar.gz`，并生成同名 `.sha256`。内容取自提交本身而不是工作树，所以包内 `SOURCE_COMMIT` 与该提交严格对应；包内文件由 `scripts/atom/sourceIdentity.ts` 的同一个渲染函数生成，与构建端解析用的是同一份格式。

要求提交已发布且工作树干净——交付包的全部价值就是「拿到包能按提交取回同一份源码」，自证不了的包不该产出。

从交付包净室构建时，必须先从 `SOURCE_COMMIT` 声明的网络远端取回该提交，并校验解包内容与之一致，再开始构建；构建端的已发布校验会独立再确认一次。

## 发布标签

标签只表达「哪一版」，提交由标签自身指向：

```bash
pnpm release:tag            # 打本地标签并打印推送命令
pnpm release:tag --push     # 打标签并推送
pnpm release:tag --dry-run  # 只做检查，不落标签
```

标签名为 `v<version>`（取自 `package.json`）。**不要把构建身份写进标签名**：历史标签形如 `1.1.1-5ae8d992-20260925-091129`，名字里的提交来自构建机本地分支，而标签实际指向 `dev` 的另一个提交——名字与被指对象不一致，按标签名反查发布代码只会得到错误答案。

打标签前强制检查：身份已发布、工作树干净、`v<version>` 在本地与远端都不存在。因此标签永远指向一个共享仓库里查得到的提交。

## runtime.json

发布身份只记录 Atom 自身与运行契约。字段清单以 `scripts/atom/stage-core-system.ts:227-262` 为准：

- `productName`
- `atomVersion`
- `buildDate`
- `atomCommit`
- `sourceDirty`
- platform / arch
- Node range/reference/bundled 状态（`nodeRange` / `nodeReference` / `nodeBundled`）
- `betterSqlite3`：staging 时实际打包的 `better-sqlite3` 版本
- Core protocol version
- data schema versions
- `capabilities`（其中含 `diretta` 能力位）
- `diretta`：本次产物是否带 Diretta
- `direttaSdkRelease`：**该字段总是存在**；不带 Diretta 的构建写 `null`（有 Diretta 时为固定 SDK release）
- `direttaCpuVariant`：`v2` / `v3` / `v4` / `zen4`；不带 Diretta 时为 `null`

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

容器本身（Dockerfile + 容器内构建脚本 + 缓存卷说明）在 [`docker/atom-debian11/`](https://github.com/bnqzzdf/splayer-atom/blob/dev/docker/atom-debian11/README.md)。

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
与 Rust stable 构建 Core/Web。该 workflow 依次执行 `pnpm typecheck`、`pnpm test`、
`pnpm build`、`pnpm package:core`，并用 `actions/upload-artifact` 上传
`out/splayer-atom-core-*-system-linux-x64.tar.gz`（`.github/workflows/dev.yml:62-78`）。
Debian 11 容器是单独的打包环境；发布时应记录实际使用的构建环境、源码提交与产物 hash。

## 发布前门禁

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm package:core
pnpm release:tag --dry-run
pnpm docs:build
pnpm docs:stamp:check
cargo check --workspace
cargo test --workspace
git diff --check
```

硬件验收另见 [hardware-release-checklist.md](./hardware-release-checklist.md)。
