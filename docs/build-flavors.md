# SPlayer Atom Build Flavors

SPlayer Atom is one product tree with shared Core domain state. Build flavors change runtime/deployment surfaces; they do not create separate player, queue, provider, settings or persistence architectures.

## Desktop flavor

The Desktop flavor is the Electron application inherited from SPlayer-Next plus the smallest Atom delta.

Primary build commands:

```bash
pnpm build
pnpm build:mac
pnpm build:win
# Linux Desktop 仅生成通用 tar.gz
pnpm build:linux
```

For exact platform targets, output names, native-module behavior and Linux glibc compatibility, see [`build-and-packaging.md`](./build-and-packaging.md).

Desktop characteristics:

- Electron main/preload/renderer processes remain available.
- The normal native audio build keeps the upstream Desktop audio integrations.
- Desktop-specific hotkeys, tray, desktop lyrics, system media presentation and related UI remain Desktop surfaces.
- Desktop Control sends playback/domain commands to the same Core-owned session logic used by Node Core; it must not regain a second raw playable-source authority path.
- The existing upstream Desktop release workflows are not yet an Atom formal release channel. Do not publish Atom by reusing upstream SPlayer updater/product identity.
- Linux Desktop packaging is intentionally limited to the generic `tar.gz` target; Windows and macOS keep their configured installer targets.
- Linux Desktop/Core native ABI compatibility is inherited from the selected build environment. A random rolling-distribution host is not a release compatibility baseline; final ELF files must be checked for their highest `GLIBC_x.y` requirement.

## Core system-runtime and bundled-runtime flavors

The Core flavor is an ordinary Node process plus Web Control. It is built from the same repository and reuses the same settings, database, provider, playback-session and plugin implementation. Runtime packaging is a deployment variant only: system-runtime uses a compatible host Node, while bundled-runtime carries the release reference Node inside `runtime/bin/node`.

Formal local gates:

```bash
# Build process itself must run on the exact reference Node 24.18.0.
# The resulting system-runtime artifact accepts a host Node >=24.18.0 <25.
pnpm exec tsx scripts/atom/build-core-system.ts

# Self-contained runtime; stages the exact reference Node 24.18.0
pnpm exec tsx scripts/atom/build-core-system.ts --bundle-node
```

The command requires Linux x86-64 and the exact reference Node `24.18.0`. It runs:

```text
core-audio native release build
→ Core JS build
→ production plugin-host IPC smoke
→ Web Control build
→ Core dependency/Electron audit
→ system-runtime or bundled-runtime staging
→ deterministic tar.gz
→ extracted-artifact HTTP/Web/schema/runtime smoke
```

The produced technical artifacts are:

```text
out/splayer-atom-core-system-linux-x64.tar.gz
out/splayer-atom-core-bundled-linux-x64.tar.gz
```

Both archives contain the same `app/`, `renderer/`, native addon, data layout and protocol contract. `runtime.json` records SPlayer Atom version/commit, dirty-worktree state, accepted SPlayer baseline, protocol/schema/capabilities and `nodeBundled`; the bundled final-artifact gate launches without `ATOM_NODE_BIN` and verifies the running executable is the archive's own `runtime/bin/node`.

Core runtime compatibility is `>=24.18.0 <25`; only the release/reference build is pinned to `24.18.0`. A second Node 24 patch smoke is intentionally not maintained.

### Core native flavor

`scripts/atom/build-core-native.ts` builds only the native modules required by Core: `audio-engine.node` and `streaming-api.node`. `audio-engine.node` uses the `core-audio` Cargo feature (plus `diretta` only when `DIRETTA_SDK_ROOT` is present); on Linux this keeps ALSA and excludes the Desktop PipeWire/PulseAudio feature set and unrelated Desktop native addons. `streaming-api.node` is the single Qobuz/TIDAL protocol engine used by Node Core.

A normal technical Core build may omit Diretta and records `diretta: false` in native/runtime capability metadata. A build that is explicitly intended to contain Diretta must request it:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
# self-contained Diretta variant uses the same gate:
pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --bundle-node
```

That mode fails if `DIRETTA_SDK_ROOT` is absent. Core Diretta release builds are pinned to **Diretta Host SDK 150** by reading the SDK's public `Host/Release.hpp`; any other release is rejected before native compilation. `build.json` and final `runtime.json` record `direttaSdkRelease: 150` when Diretta is compiled, while no-Diretta artifacts record `null`. The first formal Core release target remains Linux x86-64; AArch64 is not promoted to a supported release platform until its separate hardware gate is complete.

The proprietary SDK remains external to the repository. Any future automated SDK-enabled release job must provision the SDK outside `GITHUB_WORKSPACE`, must not place SDK contents in GitHub Secrets/Actions artifacts/release uploads, and must preserve the existing `Release.hpp` provenance check plus `--require-diretta` fail-closed build gate.

The current checked-in workflow does not contain that privileged Diretta release job. Until a controlled self-hosted/fixed release environment is committed and configured, SDK-enabled formal validation remains an operator-controlled release step rather than something ordinary `dev` CI can prove.

### Core deployment

The tar artifact carries:

- `bin/splayer-atom-core` launcher;
- `service/splayer-atom-core.service` template;
- `service/install-systemd.sh` installer;
- `docs/core-deployment.md` installation/upgrade/rollback guide;
- durable `data/` root;
- `runtime.json` SPlayer Atom release identity plus runtime/protocol/capability/schema metadata.

See [`core-deployment.md`](./core-deployment.md) for the operator procedure.

## CI responsibilities

The currently checked-in `.github/workflows/dev.yml` validates the Desktop packaging matrix on Windows, macOS and Linux. It uses Node 22.x and Rust stable; the Linux job currently runs on `ubuntu-latest` and builds the generic Linux `tar.gz`.

`ubuntu-latest` is deliberately **not** documented as a stable glibc release contract because the runner image changes over time. Formal Linux artifacts need a pinned builder/sysroot and a final ELF GLIBC-symbol audit; see [`build-and-packaging.md`](./build-and-packaging.md).

The repository already contains the local Core artifact pipeline (`build-core-system.ts`), native-flavor audit, plugin-host smoke, staging and final artifact smoke. These scripts are the current technical Core gate. The checked-in CI should not be described as a complete Core/Diretta release publisher until a fixed Linux ABI builder and the controlled SDK-enabled release environment are represented by executable release automation.

## Shared architecture contract

Both flavors must continue to share:

- canonical `Track`/media types;
- one database/settings model;
- one playback session and queue authority;
- provider auth/session implementation;
- plugin registry/host protocol;
- Core Protocol and capabilities;
- Source Direct fidelity rules.

Do not add an Electron "Headless" intermediate product, a second Core state model, or flavor-specific provider/player implementations. If a future Output Agent is needed, it must attach to the same Core contract rather than fork application state.
