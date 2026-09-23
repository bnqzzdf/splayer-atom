# SPlayer Atom Build and Packaging

The only formal product is **Linux x86-64 Node Core + Web Control**.

## Build targets

| Target      | Command             | Output                                               |
| ----------- | ------------------- | ---------------------------------------------------- |
| Native      | `pnpm build:native` | `out/native/audio-engine.node`, `streaming-api.node` |
| Node Core   | `pnpm build:core`   | `out/core/`                                          |
| Web Control | `pnpm build:web`    | `out/renderer/`                                      |
| Full build  | `pnpm build`        | all of the above                                     |

## Environment

- Linux x86-64
- Node `>=22.19.0`; formal build and bundled-runtime reference `24.18.0`
- pnpm `>=10`
- Rust stable
- ALSA headers, Clang, pkg-config, libarchive-tools

## Packaging

System runtime:

```bash
pnpm package:core
```

Bundled runtime:

```bash
pnpm package:core:bundled
```

For a glibc-compatible bundled artifact, use the pinned Debian 11 builder. It keeps
`node_modules` and the pnpm store in Docker volumes, rebuilds `better-sqlite3` inside Debian 11,
and rejects native artifacts requiring newer than glibc 2.31:

```bash
pnpm package:core:debian11
```

The builder uses the Tsinghua Debian main/updates mirrors and a fixed Debian security snapshot for
explicit package installation only. It does not install or enable unattended security updates.

Artifacts:

```text
out/splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-system-linux-x64.tar.gz
out/splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz
```

The version comes from `package.json` and the date/time are the packaging date and time in `YYYYMMDD-HHMMSS` format.
Set `ATOM_BUILD_DATE=YYYYMMDD` when a reproducible date is required. `runtime.json` also records a
human-readable `buildDate`.

Both contain the same Core JS, Web Control, project-built addons, runtime dependencies (including
`better-sqlite3`), protocol, and data schema.

## Release identity

`runtime.json` records the Atom version, build date, commit/dirty state, platform/arch, Node
contract, protocol/schema versions, capabilities, and the Diretta SDK release when applicable.
Formal releases should have `sourceDirty=false`.

## Diretta

A normal build does not require the proprietary SDK. A formal Diretta artifact must provide the supported SDK and request the required gate:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v2
```

The SDK itself is not bundled.

## CI and gates

`.github/workflows/dev.yml` builds Core/Web in a pinned `ubuntu-24.04` Linux x86-64 environment
with Node `24.18.0` and Rust stable. Formal release packages are produced from that fixed build
environment.

Recommended release gates:

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

See [Core Deployment](../core-deployment.md) and the [Hardware Release Checklist](../hardware-release-checklist.md).
