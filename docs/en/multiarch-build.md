# Multi-architecture / multi-CPU variant build and installation

> Last updated: 2026-11-12

This document covers Core builds for x86-64 (v1/v2/v3/v4/zen4) and aarch64 (arm64), the two
release packages, and the unified installer. The default install root is `/opt/splayer-atom-core`;
`--prefix` overrides it (for example `/audiosys` on an audiosys host).

## Build matrix

| Package | Variant | Diretta | Notes |
| --- | --- | --- | --- |
| `linux-x86_64-multi` | `v1` | No | SDK 148 has no x86 v1 library, so ALSA-only |
| `linux-x86_64-multi` | `v2` | SDK 148 | SSE4.2 / POPCNT |
| `linux-x86_64-multi` | `v3` | SDK 148 | AVX2 / BMI2 |
| `linux-x86_64-multi` | `v4` | SDK 148 | AVX-512 |
| `linux-x86_64-multi` | `zen4` | SDK 148 | AMD Zen 4 |
| `linux-aarch64-multi` | `arm64` | SDK 148 | Native aarch64 build |

The x86 package does not contain arm64, and the arm package does not contain x86. The installer
checks package architecture and the variant table before writing system paths.

## Build

### Five x86 variants

Inside the Debian 11 builder container, use one Core/Web/Node dependency base and compile only the
native addons per variant:

```bash
# v1: ALSA-only
env -u DIRETTA_SDK_ROOT -u DIRETTA_CPU_VARIANT \
  pnpm exec tsx scripts/atom/build-core-native.ts --output-dir out/native/v1

# v2/v3/v4/zen4
for v in v2 v3 v4 zen4; do
  DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_148 DIRETTA_CPU_VARIANT=$v \
    pnpm exec tsx scripts/atom/build-core-native.ts \
      --require-diretta --diretta-variant=$v --output-dir out/native/$v
done
```

`out/native/<variant>/build.json` records that variant's `arch/diretta/direttaCpuVariant`.

### Native arm64

On an aarch64 build host (`.230` on this site):

```bash
DIRETTA_SDK_ROOT=/root/DirettaHostSDK_148 \
  sh scripts/atom/build-arm64-native.sh
```

This writes `out/native/arm64/{audio-engine.node,streaming-api.node,build.json}`. The script uses
`cargo build --release` to produce the cdylibs, renames them to NAPI `.node` files, and does not
depend on pnpm or the napi CLI.

### Packaging

Use a complete x86 artifact as the shared base (app/renderer/node_modules/runtime), place each
variant's native files plus `runtime.json` under `variants/`:

```bash
# x86 package
sh scripts/atom/package-multiarch.sh \
  --arch x86_64 \
  --base out/splayer-atom-core-...-linux-x64.tar.gz \
  --native-root out/native \
  --out out

# arm64 package
sh scripts/atom/package-multiarch.sh \
  --arch aarch64 \
  --base out/splayer-atom-core-...-linux-x64.tar.gz \
  --native-root /path/to/arm-native-root \
  --arm-node /path/to/node-v24.22.2-linux-arm64/bin/node \
  --arm-sqlite /path/to/prebuilds/linux-arm64.node \
  --out out
```

Package names:

```text
splayer-atom-core-<version>-<commit8>-<YYYYMMDD>-linux-x86_64-multi.tar.gz
splayer-atom-core-<version>-<commit8>-<YYYYMMDD>-linux-aarch64-multi.tar.gz
```

Package layout:

```text
<top>/
  app/ renderer/ node_modules/ runtime/ data/ docs/ service/ bin/
  variants/
    v1/native/{audio-engine.node,streaming-api.node,build.json}
    v1/runtime.json
    ...
    manifest.txt
  PACKAGE_ARCH
  install.sh
  SHA256SUMS
```

## Install

```bash
./install.sh --cpu auto
./install.sh --cpu v4
./install.sh --cpu v1                  # ALSA-only
./install.sh --prefix /audiosys/splayer-atom-core --cpu auto
./install.sh --init openrc --user splayer-atom
./install.sh --uninstall               # keeps data/
./install.sh --uninstall --purge
./install.sh --rollback
```

- The default install root is `/opt/splayer-atom-core`.
- Automatic selection: zen4 → v4 → v3 → v2 → v1; aarch64 → arm64.
- The installer copies the selected `variants/<variant>/native` to `native/` and the matching
  `runtime.json` to the root.
- Upgrades keep `data/` and back up program files to `.backup-<timestamp>`; systemd and OpenRC are
  both supported.
- v1 has no Diretta; choose v2/v3/v4/zen4 when Diretta is required.
- If the target directory is non-empty and does not look like an Atom install root, the installer
  refuses to overwrite it. Prefer a dedicated subdirectory such as
  `/audiosys/splayer-atom-core`. Use `--prefix /audiosys --force` only after confirming that
  `/audiosys` is a dedicated root and may be overwritten.

## Gates

```bash
sh scripts/atom/check-multiarch-package.sh out/...-linux-x86_64-multi.tar.gz
sh scripts/atom/check-multiarch-package.sh out/...-linux-aarch64-multi.tar.gz
```

The check covers package name/architecture, variant table, ELF architecture, bundled Node,
better-sqlite3 prebuild, each `runtime.json`'s `arch/diretta/direttaCpuVariant`, the in-package
SHA256SUMS, `install.sh` syntax and permissions, and the absence of symlinks. The x86 package
additionally checks that v1 has `diretta=false`; the arm package allows arm64 only.

## Acceptance record (2026-11-12)

Build environment:

- x86 five variants: `.133` Debian 11 builder container, Node 24.22.2, Diretta SDK 148.
- arm64: `.230` native aarch64 build, Rust 1.99.0, Diretta SDK 148 aarch64 libraries.
- Source identity: `1.3.0` / `ed95ee9b` / `sourceDirty=false`.

Artifacts:

| Package | Size | SHA256 |
| --- | --- | --- |
| `splayer-atom-core-1.3.0-ed95ee9b-20261112-linux-x86_64-multi.tar.gz` | 90 MB | `32110e5c2c87a4f7e31e19eb57965ed5699d1a467cab8e2ef05e48a25ef0ffba` |
| `splayer-atom-core-1.3.0-ed95ee9b-20261112-linux-aarch64-multi.tar.gz` | 55 MB | `16f6763692ae895d10933d4961f7ef81b2d8527625831749555c1d7fe6afb5fc` |

Package gates:

- x86: `v1 v2 v3 v4 zen4` all ELF x86-64; v1 `diretta=false`, the others `diretta=true/sdk=148`;
  bundled Node and better-sqlite3 are x64; PASS.
- arm: `arm64` ELF aarch64, `diretta=true/sdk=148/variant=arm64`; bundled Node and better-sqlite3
  are arm64; PASS.

Install/start verification:

- `.137` x86 package `--cpu v4`: installed to a test prefix; Core `/api/info` returned
  `version=1.3.0`, `commit=ed95ee9b`, `arch=x64`, `node=24.22.2`, `direttaSdkRelease=148`,
  `capabilities.diretta=true`; native addons loaded.
- `.137` x86 package `--cpu v1`: `direttaSdkRelease=null`, `capabilities.diretta=false`; native
  addons loaded.
- `.230` arm package `--cpu arm64`: `version=1.3.0`, `commit=ed95ee9b`, `arch=arm64`,
  `node=24.22.2`, `direttaSdkRelease=148`, `capabilities.diretta=true`; native addons loaded.
- The arm64 build found and fixed the `c_char` signedness in `direct_pcm.rs` (`a5a25b14`); x86 is
  unaffected.

## Audit conclusions (this round)

- Static/dynamic gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cargo test --workspace`,
  and clippy 1.99.x all passed.
- Fixed: arm64 `c_char` signedness; `--output-dir` argument ordering; base artifact SHA256
  verification; native `build.json` consistency with package architecture/variants; arm64 build
  `--locked`; the installer now refuses a non-empty directory that does not look like an Atom
  install root (unless `--force`).
- Normalization: `DirettaCpuVariant` distinguishes x86 variants from arm64; documentation, scripts,
  and package manifests use the same `v1/v2/v3/v4/zen4/arm64` names.
- Redundancy/performance: measured DST-DFF extraction is 96 ms (versus 28.3 s for DSF), removing
  DST decode. The remaining cost is I/O and chunk writes; further native allocator changes have low
  return and would invalidate validated artifacts, so they are out of scope for this round.

Note: the default install root is `/opt/splayer-atom-core`; tests use a separate prefix to avoid
overwriting an existing production Core. For audiosys, prefer
`--prefix /audiosys/splayer-atom-core`; overwriting `/audiosys` directly requires an explicit
`--force`, and the installer otherwise refuses a non-empty directory that does not look like an
Atom install root.
