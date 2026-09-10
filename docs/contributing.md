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

涉及架构或播放链路的改动，提交前请阅读根目录 `AGENTS.md` 与
[Atom Roadmap](./atom-roadmap.md)。通常情况下，曲库、在线服务、播放与输出逻辑放在 Core，
界面与交互放在 Web Control。更严格的实现约束统一维护在 `AGENTS.md`，不在用户文档中重复。

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
