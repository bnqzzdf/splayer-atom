# SPlayer Atom Build Flavors

SPlayer Atom has one product architecture and two deployment variants. There is no Desktop flavor.

## Core native flavor

The supported Linux x86-64 Core native runtime contains:

- `audio-engine.node`
- `streaming-api.node`

The audio addon is built with the `core-audio` feature set. It must not pull PipeWire/PulseAudio or Desktop-only native modules into the formal artifact.

## Diretta capability

Without `DIRETTA_SDK_ROOT`, Core builds without Diretta.

With a supported `DIRETTA_SDK_ROOT`, `audio-engine` adds the `diretta` feature. A formal Diretta artifact must use:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v2
```

`--diretta-variant` selects the x86-64 Host SDK library flavor (`v2`, `v3`, or `v4`). The selected
variant is passed to the native Cargo build and recorded in the artifact metadata. A Diretta build
must specify it explicitly; it is not silently defaulted to `v2`.

The SDK remains external and is not bundled.

## system-runtime

```bash
pnpm package:core
```

Produces `splayer-atom-core-<version>-<YYYYMMDD>-system-linux-x64.tar.gz` and requires a compatible system Node `>=22.19.0`.

## bundled-runtime

```bash
pnpm package:core:bundled
```

Produces `splayer-atom-core-<version>-<YYYYMMDD>-bundled-linux-x64.tar.gz` and carries the reference Node runtime used for the build.

Both variants contain the same Core JS, Web Control, native addons, protocol version and data schema.
