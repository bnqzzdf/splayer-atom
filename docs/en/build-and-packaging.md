# SPlayer Atom Build and Packaging

This document follows the current repository scripts and `electron-builder.config.ts`. It covers Desktop, Node Core, Rust/N-API native modules, and Linux release compatibility. See [`../build-flavors.md`](../build-flavors.md) for architecture boundaries and [`../core-deployment.md`](../core-deployment.md) for Core installation, upgrade, and rollback.

## 1. Build surfaces

| Surface   | Entry point                         | Runtime                                 | Current artifacts                                      |
| --------- | ----------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Desktop   | `pnpm build:*`                      | Electron + Vue + Rust/N-API             | Windows NSIS/portable, macOS DMG/ZIP, Linux `tar.gz`   |
| Node Core | `scripts/atom/build-core-system.ts` | regular Node + Web Control + Rust/N-API | Linux x86-64 system-runtime / bundled-runtime `tar.gz` |

Desktop and Core share the same music-domain authority. A build flavor changes the host/deployment surface, not the queue/provider/player architecture.

## 2. Toolchain requirements

Current root `package.json` constraints:

- Desktop development: Node.js `>=22.19.0`;
- pnpm: `>=10`, repository pinned to `pnpm@11.5.2`;
- Rust: stable toolchain installed via rustup;
- formal Core artifact build: **exact Node `24.18.0`**; Core runtime range is `>=24.18.0 <25`.

Typical Debian/Ubuntu Desktop native build dependencies:

```bash
sudo apt update
sudo apt install -y build-essential clang pkg-config \
  libasound2-dev libdbus-1-dev libpipewire-0.3-dev libpulse-dev
```

The Core `core-audio` flavor only needs the ALSA-side native dependency set; it does not enable the Desktop PipeWire/PulseAudio output features.

## 3. Development and application build

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds native addons in debug mode first, then starts Electron. Renderer-only work may use:

```bash
SKIP_NATIVE_BUILD=true pnpm dev
```

Full application build:

```bash
pnpm build
```

Pipeline:

```text
clean dist
→ scripts/build-native.ts release N-API build
→ pnpm typecheck
→ electron-vite build
```

Native modules only:

```bash
pnpm build:native
pnpm build:native --dev
```

## 4. Desktop packaging

### Unpacked application

```bash
pnpm build:unpack
```

Use the unpacked output for local runtime acceptance, `resources/native/*.node` inspection, Linux ELF/glibc scanning, and `extraResources`/ASAR diagnostics.

### Windows

```bash
pnpm build:win
pnpm build:win --x64
```

Current targets are NSIS setup and portable executables. `scripts/gen-license.ts` runs before packaging.

### macOS

```bash
pnpm build:mac
pnpm build:mac --arm64
pnpm build:mac --x64
```

Current targets are DMG and ZIP. The checked-in config does not enable signing/notarization (`identity: null`, `notarize: false`), so a local package is not a signed/notarized production release.

### Linux Desktop

```bash
pnpm build:linux
pnpm build:linux --x64
```

The current Linux target is **`tar.gz` only**. Older README text mentioning AppImage/deb/rpm/pacman no longer matches the checked-in scripts.

### Architecture

The project does not treat `electron-builder --x64/--arm64` as a complete native cross-compilation solution. Rust/N-API addons must match the final Electron/Node runtime architecture. Build formal artifacts on the target architecture or a fully validated fixed builder.

## 5. Node Core artifacts

System runtime:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts
```

Produces:

```text
out/splayer-atom-core-system-linux-x64.tar.gz
```

Bundled runtime:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts --bundle-node
```

Produces:

```text
out/splayer-atom-core-bundled-linux-x64.tar.gz
```

The bundled variant includes reference Node under `runtime/bin/node`, but it does **not** remove glibc requirements: Node itself, `better-sqlite3`, `audio-engine.node`, `streaming-api.node`, and other native ELF files still depend on the Linux ABI.

The Core build script runs native release build, Core JS, plugin-host smoke, Web Control, dependency/Electron audit, staging, archive creation, and final extracted-artifact smoke.

Core native output is intentionally limited to:

```text
audio-engine.node
streaming-api.node
```

`audio-engine` is built with `--no-default-features --features core-audio`, keeping the Linux Core audio flavor ALSA-only unless Diretta is explicitly added.

## 6. Diretta builds

The proprietary SDK is external to the repository. A normal Core build does not require it.

Formal Diretta Core:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

Bundled runtime plus Diretta:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --bundle-node
```

The current scripts read `Host/Release.hpp` and require Diretta Host SDK release `150`. Missing or mismatched SDK provenance fails the `--require-diretta` build before a same-named formal artifact is produced.

Desktop `scripts/build-native.ts` simply adds the `diretta` feature to `audio-engine` when `DIRETTA_SDK_ROOT` is present.

## 7. Linux glibc / ABI compatibility

Linux Desktop and Core both ship dynamically linked ELF binaries: Electron/Node, N-API `.node` files, `better-sqlite3`, and Rust/C/C++ dependencies. The project currently does **not** pin a minimum glibc through a dedicated sysroot, manylinux-like toolchain, or symbol-version linker policy.

Therefore a build performed on a glibc 2.43 host can actually acquire a `GLIBC_2.43` symbol requirement if a compiler or dependency uses a symbol introduced at that level. Such a file will not load on a host that only provides glibc 2.39 or 2.35.

The build host version is not automatically the minimum: the real minimum is the **highest GLIBC symbol version actually referenced by every final ELF file**.

### Release rule

Do not build public Linux artifacts directly on an arbitrary rolling developer system. Select and pin a release builder/sysroot first.

- To support systems at a glibc 2.35 baseline, build and validate every native component in an environment that does not exceed that ABI.
- Ubuntu 24.04 is an example of a fixed glibc 2.39 builder baseline.
- Always verify the final artifact; the builder's `ldd --version` alone is not sufficient.

The checked-in `.github/workflows/dev.yml` currently uses `ubuntu-latest`. That label moves over time and therefore **is not a stable minimum-glibc contract**. A formal Linux release should use an explicit runner/container version or a dedicated fixed release environment.

Check the build host:

```bash
ldd --version
```

Inspect one ELF:

```bash
objdump -T path/to/file \
  | grep -o 'GLIBC_[0-9.]*' \
  | sort -Vu
```

The final line is the highest GLIBC symbol version used by that file.

For Desktop, build unpacked first:

```bash
pnpm build:unpack
```

Then scan the final directories; Core should be scanned after staging/extraction as well:

```bash
find dist out -type f \( -name '*.node' -o -name '*.so' -o -perm -111 \) -print0 |
while IFS= read -r -d '' file; do
  max=$(
    objdump -T "$file" 2>/dev/null |
      grep -o 'GLIBC_[0-9.]*' |
      sort -Vu |
      tail -1
  )
  [ -n "$max" ] && printf '%-14s %s\n' "$max" "$file"
done
```

Do not inspect only `audio-engine.node`; Electron/Node, `better-sqlite3`, or another addon may define the actual compatibility floor.

## 8. Release checks

Common software gates:

```bash
pnpm typecheck
pnpm test
```

Audio Core changes should at least run:

```bash
cargo fmt --check -p audio-engine-core
cargo test -p audio-engine-core
```

Linux Desktop native acceptance may also run:

```bash
cargo test -p audio-engine
```

The formal Core build script already performs final artifact smoke. Do not treat a raw `out/core` Vite output as a release artifact.

Before a public Linux release, also confirm that the worktree is clean, the builder/sysroot is pinned, all final ELF files meet the intended GLIBC floor, native addons load in the final runtime, and the relevant hardware gates have passed.

## 9. Current CI versus formal release

The currently checked-in `.github/workflows/dev.yml` is primarily a `dev` branch Desktop matrix for Windows, macOS, and Linux. It uses Node 22.x and Rust stable; Linux runs `pnpm build:linux --x64`.

The repository already contains Core artifact scripts, Diretta SDK provenance checks, and final artifact smoke, but the checked-in workflow should **not** be treated as a complete Core/Diretta production release pipeline. A formal release still needs a fixed Linux ABI builder, controlled SDK environment, and the roadmap/hardware-checklist acceptance gates.
