# SPlayer Atom Development Setup

> Last updated: 2026-10-15

Project constraints live in the repository's `AGENTS.md`; current priorities and acceptance status
live in the [roadmap](./atom-roadmap.md). This guide covers development workflows and conventions.

## Requirements

- Node `>=22.19.0`
- pnpm `>=10`
- Rust stable
- Linux x86-64
- `libasound2-dev`, `pkg-config`, `clang` (`libarchive-tools` is only needed by the CI dependency install line; local builds can omit it)

Formal builds and bundled-runtime artifacts use reference Node `24.18.0`. The runtime support
range and release reference are defined in `core/atom/runtime/nodeRuntime.ts`.

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
scripts/atom/core-system/ service definitions and launcher: systemd unit, OpenRC script, both installers
docker/atom-debian11/    Debian 11 compatibility build image (the packaging path used on .133)
docs/                    Atom documentation (bilingual; English under docs/en/)
```

`@main/*` is the TypeScript alias for the `core/` tree. For conventions on changing the service definitions (systemd unit and OpenRC script) see [Core deployment and upgrades](./core-deployment.md) and [GentooPlayer (OpenRC) service management](./gentooplayer-openrc.md).

## Change and commit conventions

- `origin` is the development and release repository.
- Commit titles use Conventional Commits with a one-line Chinese summary (`<type>: <summary>`).
- Add a commit body only when explicitly requested.
- Do not format or rewrite unrelated dirty files.
- Use concise JSDoc for JS/TS when useful (`@param name - ...`, `@returns`); other languages use
  their native documentation conventions. Avoid decorative comments and obvious restatements.
- `.prettierrc.yaml` defines formatting. Follow existing Vue/Pinia/router/VueUse/i18n auto-import
  and component auto-registration patterns.

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

## Core/Web implementation

Extend `buildCoreControlRoutes()` and the existing HTTP/WS clients for Control operations.
Shared protocol types live in `shared/types/`. Music-domain settings are Core-owned; browser-local
display preferences remain in Web Control.

Use the 300 px cover for blurred, sampled, and list rendering; use original images only where
visibly required.

Local album, artist, and song pages show an empty-library message only after a successful Core
list request returns no items. Pending requests show a loading indicator; failures provide a
retry action, while existing cached songs remain visible. If the network or Core is unavailable,
check the corresponding `/api/library/albums`, `artists`, or `tracks` request and Core logs, then
retry after restoring connectivity. An empty-library message during a pending or failed request
indicates a frontend state-handling defect.

## Native development

```bash
pnpm build:native --dev
cargo check --workspace
cargo test --workspace
```

The project-built addons are `audio-engine.node` and `streaming-api.node`. Required third-party
native dependencies such as `better-sqlite3` are packaged separately. See [Native Modules](./native.md)
and [Build Flavors](./build-flavors.md) for module responsibilities and dependency checks.

## Diretta

Normal builds do not require the proprietary SDK. Diretta builds set `DIRETTA_SDK_ROOT` and an
explicit CPU variant; formal Diretta packaging must pass the required-SDK provenance gate before
producing an artifact. See [Build Flavors](./build-flavors.md#diretta-capability) for the command.

Linux live Diretta connection/playback validation runs the Host process as root. Follow the
[deployment setup](./core-deployment.md) and [hardware checklist](./hardware-release-checklist.md).

## Release development

```bash
pnpm package:core
pnpm package:core:bundled
pnpm package:core:debian11 --without-diretta
```

The Debian 11 builder also accepts `--with-diretta --diretta-variant=v2|v3|v4|zen4` with SDK 150 set
through `DIRETTA_SDK_ROOT`; see [Build Flavors](./build-flavors.md#debian-11-bundled-build).

Validate the final Linux x86-64 `tar.gz`, including runtime metadata, native addon loading, Web root,
HTTP/WS endpoints, plugin-host IPC, startup, and termination. Real ALSA/Diretta/PCM/Native-DSD/UPnP
and long-run behavior require separate hardware acceptance; software checks do not replace it.

See [Build and Packaging](./build-and-packaging.md), [Core Deployment](./core-deployment.md), and
[Hardware Release Checklist](./hardware-release-checklist.md) for the detailed procedures.
