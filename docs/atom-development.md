# SPlayer Atom Development Setup

## Product baseline

SPlayer Atom has one runtime shape:

- Linux x86-64 Node Core;
- Web Control as the only UI;
- Core HTTP/WebSocket as the only Control transport.

Do not add Electron, preload/IPC, Desktop windows, Windows/macOS packaging, or a second playback/data authority.

## Requirements

- Node `>=24.18.0 <25`
- pnpm `>=10`
- Rust stable
- Linux x86-64
- `libasound2-dev`, `pkg-config`, `clang`, `libarchive-tools`

## Start development

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds the native addons in debug mode, starts Node Core, and starts the standalone Web Vite dev server.

## Repository layout

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

`@main/*` remains the TypeScript alias for the `core/` tree; it is a source alias, not an Electron main-process concept.

## Common gates

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

Use proportional checks while iterating. Architecture or release changes should run the full set.

## Core/Web ownership

Core owns database, settings, library, provider sessions, queue, playback policy, playable-source resolution, cache/preload, downloads, statistics, plugins, ListenBrainz and output assignment.

Web Control may cache projections for rendering, but must not own a second queue, provider session, playback lifecycle, Direct staging path or output state.

## Native development

```bash
pnpm build:native --dev
cargo check --workspace
cargo test --workspace
```

The formal Core native flavor contains only `audio-engine.node` and `streaming-api.node`.

## Diretta

Normal development builds do not require the proprietary SDK. A Diretta-enabled build uses `DIRETTA_SDK_ROOT`; a formal Diretta artifact must also pass `--require-diretta` during Core packaging.

Source Direct invariants are defined in `AGENTS.md` and must not be weakened for convenience.

## Release development

```bash
pnpm package:core
pnpm package:core:bundled
```

The release unit is the final Linux x86-64 tar.gz artifact. See [Build and Packaging](./build-and-packaging.md), [Core Deployment](./core-deployment.md), and [Hardware Release Checklist](./hardware-release-checklist.md).
