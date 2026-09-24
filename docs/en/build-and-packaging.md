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
and rejects native artifacts requiring newer than glibc 2.31. The default has no Diretta:

```bash
pnpm package:core:debian11 --without-diretta
```

To include Diretta, supply SDK 150 and select an x86-64 library variant (`v2`, `v3`, or `v4`):

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

The SDK is mounted read-only and is not packaged. The builder checks native glibc requirements,
Diretta capability metadata, and startup of the extracted artifact. It retains separate
`*-debian11-without-diretta.tar.gz` and `*-debian11-with-diretta-<variant>.tar.gz` copies.
SDK 150's ACQUA library uses an old-glibc compatibility shim for integer parsing.

The builder uses the Tsinghua Debian main/updates mirrors and a fixed Debian security snapshot for
explicit package installation only. It does not install or enable unattended security updates.

Artifacts:

```text
out/splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-system-linux-x64.tar.gz
out/splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz
```

The version comes from `package.json` and the date and time are the packaging date/time in `YYYYMMDD-HHMMSS` format.
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

`.github/workflows/dev.yml` builds Core/Web on `ubuntu-24.04` Linux x86-64 with Node `24.18.0`
and Rust stable. The Debian 11 container is a separate packaging environment. Record the actual
build environment, source commit, and artifact hash for a release.

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
