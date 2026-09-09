# 贡献指南

欢迎为 SPlayer Atom 贡献代码。

## 环境

- Linux x86-64
- Node `>=24.18.0 <25`
- pnpm `>=10`
- Rust stable

```bash
git clone https://github.com/bnqzzdf/splayer-atom.git
cd splayer-atom
pnpm install
pnpm dev
```

## 架构规则

提交前先阅读根目录 `AGENTS.md` 与 [Atom Roadmap](./atom-roadmap.md)。

- Node Core 是唯一音乐域权威；
- Web Control 是唯一 UI；
- 不引入 Electron/Desktop/Host capability；
- 不建立第二套 queue、player、provider、settings 或 persistence model；
- Diretta 保持 strict Source Direct，不能静默 DSP/fallback。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm docs:build
cargo check --workspace
cargo test --workspace
```

## 提交

提交标题使用 Conventional Commits，并使用一句中文摘要，例如：

```text
fix: 修复 Core 队列恢复状态
docs: 更新 Core 部署说明
```

不要在一个提交中混入无关格式化或重构。

## 发布相关改动

涉及构建、native、artifact、Core HTTP/WS 或部署时，还应运行 `pnpm package:core` 并检查最终 tar.gz。真实 ALSA/Diretta/UPnP 验收按 [硬件发布清单](./hardware-release-checklist.md) 单独执行。
