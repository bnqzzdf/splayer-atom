# Contributing

> Last updated: 2026-10-03

Contributions to SPlayer Atom are welcome.

## Environment

- Linux x86-64
- Node `>=22.19.0`
- pnpm `>=10`
- Rust stable

```bash
git clone https://github.com/bnqzzdf/splayer-atom.git
cd splayer-atom
pnpm install
pnpm dev
```

## Architecture rules

For architecture or playback changes, read the root `AGENTS.md` and the
[Atom Roadmap](./atom-roadmap.md). As a general rule, library, provider, playback, and output behavior
belongs in Core, while interface and interaction behavior belongs in Web Control. Detailed
implementation constraints are kept in `AGENTS.md` instead of being repeated in user-facing docs.

## Common gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm docs:build
cargo check --workspace
cargo test --workspace
```

## Commits

Commit titles use Conventional Commits with a one-line Chinese summary, following repository
policy. For example:

```text
fix: 修复 Core 队列恢复状态
docs: 更新 Core 部署说明
```

Do not mix unrelated formatting or refactoring into one commit.

## Release-related changes

For changes that touch builds, native code, artifacts, Core HTTP/WS, or deployment, also run
`pnpm package:core` and inspect the resulting tar.gz. Real ALSA/Diretta/UPnP acceptance runs
separately, following the [Hardware Release Checklist](./hardware-release-checklist.md).
