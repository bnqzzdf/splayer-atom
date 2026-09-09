# SPlayer Atom Build and Packaging

The only formal product is **Linux x86-64 Node Core + Web Control**.

## Build targets

| Target      | Command             | Output                                               |
| ----------- | ------------------- | ---------------------------------------------------- |
| Native      | `pnpm build:native` | `out/native/audio-engine.node`, `streaming-api.node` |
| Node Core   | `pnpm build:core`   | `out/core/`                                          |
| Web Control | `pnpm build:web`    | `out/renderer/`                                      |
| Full build  | `pnpm build`        | all of the above                                     |

There is no Electron build, Windows/macOS build, or Desktop package target.

## Environment

- Linux x86-64
- Node `>=24.18.0 <25`; release reference `24.18.0`
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

Artifacts:

```text
dist/splayer-atom-core-system-linux-x64.tar.gz
dist/splayer-atom-core-bundled-linux-x64.tar.gz
```

Both contain the same Core JS, Web Control, native addons, protocol, and data schema.

## Release identity

`runtime.json` records Atom version/commit/dirty state, platform/arch, Node contract, protocol/schema versions, capabilities, and the Diretta SDK release when applicable. Formal releases should have `sourceDirty=false`.

## Diretta

A normal build does not require the proprietary SDK. A formal Diretta artifact must provide the supported SDK and request the required gate:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

The SDK itself is not bundled.

## Linux glibc ABI

Rust/N-API binaries and bundled Node are ELF files. The real minimum glibc requirement is determined by the highest versioned `GLIBC_x.y` symbol used anywhere in the final artifact.

Formal releases must use a pinned older Linux builder/sysroot and audit every shipped ELF. A rolling distribution or glibc 2.43 development host should not be used directly as the public release builder.

## CI and gates

`.github/workflows/dev.yml` builds only Linux x86-64 Core/Web on Node `24.18.0` and Rust stable.

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
