# SPlayer Atom 开发环境

> 最后更新：2026-09-28

项目约束位于仓库的 `AGENTS.md`；当前优先级与验收状态位于[路线图](./atom-roadmap.md)。本指南涵盖
开发工作流与约定。

## 环境要求

- Node `>=22.19.0`
- pnpm `>=10`
- Rust stable
- Linux x86-64
- `libasound2-dev`、`pkg-config`、`clang`（`libarchive-tools` 只有 CI 的依赖安装行需要，本地构建可省略）

正式构建与 bundled-runtime 产物使用 reference Node `24.18.0`。运行时支持范围与发布参考版本定义在
`core/atom/runtime/nodeRuntime.ts`。

## 开始开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 以 debug 模式构建 native addon、启动 Node Core，并启动独立的 Web Vite dev server。

## 仓库结构

```text
core/                    Node Core runtime and services
src/                     Web Control
shared/                  Core/Web protocol and shared domain types
native/audio-engine/     N-API audio binding
native/audio-engine-core shared Rust audio engine
native/streaming-api/    Qobuz/TIDAL native protocol engine
native/diretta-sys/      Diretta Host SDK FFI
scripts/atom/            Core build, staging and release checks
docs/                    Atom documentation
```

`@main/*` 是 `core/` 目录树的 TypeScript 别名。

## 变更与提交约定

- `origin` 是开发与发布仓库。
- 提交标题使用 Conventional Commits，并配一行中文摘要（`<type>: <summary>`）。
- 仅在明确要求时添加提交正文。
- 不要格式化或改写无关的脏文件。
- JS/TS 在有用时使用简洁 JSDoc（`@param name - ...`、`@returns`）；其它语言使用各自的文档约定。
  避免装饰性注释与显而易见的复述。
- `.prettierrc.yaml` 定义格式化。遵循现有的 Vue/Pinia/router/VueUse/i18n 自动导入与组件自动注册模式。

## 常用门禁

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm docs:build
cargo check --workspace
cargo test --workspace
git diff --check
```

迭代时按比例选择检查范围。架构或发布变更应运行完整集合。

## Core/Web 实现

为 Control 操作扩展 `buildCoreControlRoutes()` 与现有 HTTP/WS 客户端。共享协议类型位于
`shared/types/`。音乐域设置由 Core 持有；浏览器本地显示偏好保留在 Web Control。

模糊、采样与列表渲染使用 300 px 封面；仅在视觉上确有必要时使用原图。

## Native 开发

```bash
pnpm build:native --dev
cargo check --workspace
cargo test --workspace
```

项目自建的 addon 是 `audio-engine.node` 与 `streaming-api.node`。所需第三方 native 依赖（例如
`better-sqlite3`）单独打包。模块职责与依赖检查见[原生模块](./native.md)与[构建面](./build-flavors.md)。

## Diretta

普通构建不需要专有 SDK。Diretta 构建设置 `DIRETTA_SDK_ROOT` 与显式的 CPU 变体；正式 Diretta 打包
必须先通过 required-SDK provenance 门禁，才能产出产物。命令见
[构建面](./build-flavors.md#diretta-能力)。

Linux 实机 Diretta 连接/播放验收以 root 运行 Host 进程。遵循[部署设置](./core-deployment.md)与
[硬件清单](./hardware-release-checklist.md)。

## 发布开发

```bash
pnpm package:core
pnpm package:core:bundled
pnpm package:core:debian11 --without-diretta
```

Debian 11 构建器还接受 `--with-diretta --diretta-variant=v2|v3|v4|zen4`，SDK 150 通过
`DIRETTA_SDK_ROOT` 指定；见[构建面](./build-flavors.md#debian-11-bundled-构建)。

验收最终的 Linux x86-64 `tar.gz`，包括运行时元数据、native addon 加载、Web 根页、HTTP/WS 端点、
plugin-host IPC、启动与终止。真实的 ALSA/Diretta/PCM/Native-DSD/UPnP 与长跑行为需要单独的硬件验收；
软件检查不能替代它。

详细流程见[构建与打包](./build-and-packaging.md)、[Core 部署](./core-deployment.md)与
[硬件发布验收清单](./hardware-release-checklist.md)。
