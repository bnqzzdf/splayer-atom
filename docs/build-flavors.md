# SPlayer Atom Build Flavors

SPlayer Atom has two deployment variants: system-runtime and bundled-runtime.

## Core native flavor

The Linux x86-64 Core build produces two project-owned native addons:

- `audio-engine.node`
- `streaming-api.node`

Required third-party native dependencies, including `better-sqlite3`, are packaged separately.

The audio addon uses the `core-audio` feature set with ALSA. The build rejects PipeWire/PulseAudio
dynamic dependencies in the formal artifact.

The streaming addon uses Rustls with system CA certificates and must not dynamically depend on
OpenSSL (`libssl.so` or `libcrypto.so`). The target system still needs a usable CA certificate store
for HTTPS provider requests.

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

## Debian 11 bundled build

The Debian 11 builder uses glibc 2.31 and can package either capability set:

```bash
pnpm package:core:debian11 --without-diretta

DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

The first mode is the default. The second mode mounts SDK 150 read-only and uses its selected
`v2`, `v3`, or `v4` x86-64 libraries. The build checks the packaged native modules against glibc
2.31, checks the Diretta capability metadata, and runs the extracted-artifact smoke. SDK 150's
ACQUA library receives the required old-glibc integer parsing compatibility symbols at link time;
the SDK files are not packaged. Mode-specific copies are retained as
`*-debian11-without-diretta.tar.gz` and `*-debian11-with-diretta-<variant>.tar.gz`.

On 2026-09-23, no-Diretta and Diretta v3 packages passed software smoke from a dirty working tree.
This does not establish a clean release artifact or Diretta Target playback; v2/v4 were not built
in that run.

## system-runtime

```bash
pnpm package:core
```

Produces `splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-system-linux-x64.tar.gz` and requires a compatible system Node `>=22.19.0`.

## bundled-runtime

```bash
pnpm package:core:bundled
```

Produces `splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz` and carries the reference Node runtime used for the build.

Both variants contain the same Core JS, Web Control, native addons, protocol version and data schema.
