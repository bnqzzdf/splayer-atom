# SPlayer Atom Build Flavors

> Last updated: 2026-11-06

SPlayer Atom's Core artifacts combine three independent dimensions:

- **Runtime flavor**: `node` (default release baseline) or `bun` (experimental).
- **Deployment**: `system-runtime` (use a host runtime) or `bundled-runtime` (ship the runtime).
- **Audio capability / CPU**: without Diretta, or SDK 148 with an explicit `v2` / `v3` /
  `v4` / `zen4` CPU variant.

Node and Bun share the Core JS, Web, native addons, protocol and data schema, along with the
build, staging, artifact smoke and `bin/splayer-atom-core` launcher. They are not two Core
implementations. `mise.toml` pins build-time Node `24.22.2` and optional Bun `1.4.4`
(`mise install`).

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

`--diretta-variant` selects the x86-64 Host SDK library flavor (`v2`, `v3`, `v4`, or `zen4`). The
flavor decides whether the artifact can run on the target CPU at all, not just how fast. The selected
variant is passed to the native Cargo build and recorded in the artifact metadata. A Diretta build
must specify it explicitly; it is not silently defaulted to `v2`.

The SDK remains external and is not bundled.

## Debian 11 build

The Debian 11 builder uses glibc 2.31 and produces a system-runtime package by default. Add
`--bundle-runtime` (or `--bundle-node`) to include Node, with or without Diretta:

```bash
pnpm package:core:debian11 --without-diretta
pnpm package:core:debian11 --without-diretta --bundle-runtime

DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_148 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

Diretta is disabled by default. The Diretta build mounts SDK 148 read-only and uses its selected
`v2`, `v3`, `v4`, or `zen4` x86-64 libraries. The build checks the packaged native modules against glibc
2.31, checks the Diretta capability metadata, and runs the extracted-artifact smoke. SDK 148's
ACQUA library receives the required old-glibc integer parsing compatibility symbols at link time;
the SDK files are not packaged. After validation, the archive is renamed to
`*-debian11-without-diretta.tar.gz` and `*-debian11-with-diretta-<variant>.tar.gz`.

On 2026-09-23, no-Diretta and Diretta v3 packages passed software smoke from a dirty working tree.
This does not establish a clean release artifact or Diretta Target playback; v2/v4 were not built
in that run.

## Runtime × deployment

| Runtime            | system-runtime          | bundled-runtime                 |
| ------------------ | ----------------------- | ------------------------------- |
| Node (default)     | `pnpm package:core`     | `pnpm package:core:bundled`     |
| Bun (experimental) | `pnpm package:core:bun` | `pnpm package:core:bun:bundled` |

All commands use `scripts/atom/build-core-system.ts` with `--runtime=node|bun` and
`--bundle-runtime`. Legacy `--bundle-node` remains valid for Node bundled. Set
`ATOM_BUN_BIN` to provide a custom Bun executable. Every flavor is **built** using Node
`24.22.2`, even when the packaged Core runs on Bun.

## system-runtime

```bash
pnpm package:core
```

Node produces `splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz`.
The Bun artifact adds `-bun` before `-system`.

Node system-runtime requires host Node `>=22.19.0` at **runtime**. Bun system-runtime
requires an available Bun (the project-tested version is `1.4.4`). This is different from the
Node `24.22.2` **build** requirement shared by all flavors.

## bundled-runtime

```bash
pnpm package:core:bundled
```

Node bundled ships `runtime/bin/node`; Bun bundled ships `runtime/bin/bun` and inserts
`-bun` before `-bundled` in the artifact filename. Neither requires that runtime to be
installed separately on the target. `runtime.json` records `runtime.name/version/pluginHost`,
`nodeBundled` and `bunBundled`. A `runtime/bun` marker selects Bun in the shared launcher.

The [runtime comparison](../history/bun-runtime-experiment.md) (Chinese only) records the bounded
empty-library API benchmark, separate-process plugin Host and limitations. A VM Context is not
a security sandbox for malicious plugins. Bun still needs target-hardware, prolonged playback,
plugin, distribution and upgrade acceptance; it is not yet a formal release artifact. Review
the Bun license and statically linked component obligations before redistributing bundled Bun.
