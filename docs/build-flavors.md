# SPlayer Atom Build Flavors

SPlayer Atom is one product tree with shared Core domain state. Build flavors change runtime/deployment surfaces; they do not create separate player, queue, provider, settings or persistence architectures.

## Desktop flavor

The Desktop flavor is the Electron application inherited from SPlayer-Next plus the smallest Atom delta.

Primary build commands:

```bash
pnpm build
pnpm build:linux
pnpm build:mac
pnpm build:win
```

Desktop characteristics:

- Electron main/preload/renderer processes remain available.
- The normal native audio build keeps the upstream Desktop audio integrations.
- Desktop-specific hotkeys, tray, desktop lyrics, system media presentation and related UI remain Desktop surfaces.
- Desktop Control sends playback/domain commands to the same Core-owned session logic used by Node Core; it must not regain a second raw playable-source authority path.
- The existing upstream Desktop release workflows are not yet an Atom formal release channel. Do not publish Atom by reusing upstream SPlayer updater/product identity.

## Core system-runtime flavor

The Core flavor is an ordinary Node process plus Web Control. It is built from the same repository and reuses the same settings, database, provider, playback-session and plugin implementation.

Formal local gate:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts
```

The command requires Linux x86-64 and the exact reference Node `24.18.0`. It runs:

```text
core-audio native release build
→ Core JS build
→ production plugin-host IPC smoke
→ Web Control build
→ Core dependency/Electron audit
→ system-runtime staging
→ deterministic tar.gz
→ extracted-artifact HTTP/Web/schema smoke
```

The produced technical artifact is:

```text
out/core-system-linux-x64.tar.gz
```

Core runtime compatibility is `>=24.18.0 <25`; only the release/reference build is pinned to `24.18.0`. A second Node 24 patch smoke is intentionally not maintained.

### Core native flavor

`scripts/atom/build-core-native.ts` builds only `audio-engine.node` with the `core-audio` Cargo feature. On Linux this keeps ALSA and excludes the Desktop PipeWire/PulseAudio feature set and unrelated Desktop native addons.

A normal technical Core build may omit Diretta and records `diretta: false` in native/runtime capability metadata. A build that is explicitly intended to contain Diretta must request it:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

That mode fails if `DIRETTA_SDK_ROOT` is absent. Core Diretta release builds are pinned to **Diretta Host SDK 149** by reading the SDK's public `Host/Release.hpp`; any other release is rejected before native compilation. `build.json` and final `runtime.json` record `direttaSdkRelease: 149` when Diretta is compiled, while no-Diretta artifacts record `null`. The first formal Core release target remains Linux x86-64; AArch64 is not promoted to a supported release platform until its separate hardware gate is complete.

The proprietary SDK remains external to the repository. SDK-enabled release validation uses the separate manual `Core Diretta Release Gate` on a controlled self-hosted Ubuntu 24.04 x86-64 runner labeled `diretta-sdk-149`. The runner administrator provisions SDK 149 read-only at `/opt/diretta/HostSDK_149`, outside `GITHUB_WORKSPACE`; the workflow never stores the SDK in GitHub Secrets, the repository, Actions artifacts or release uploads. The existing `Release.hpp` check and `--require-diretta` build gate remain authoritative.

The Diretta release runner is intentionally not used for pull requests or ordinary `dev` pushes. It is a privileged release resource: only an explicit `workflow_dispatch` on `dev`, behind the `diretta-release` GitHub Environment, may consume it. The environment exists and has a custom deployment branch policy allowing only `dev`. The runner image must provide Ubuntu 24.04 x86-64, ALSA development headers, `pkg-config` and `clang`; Node 24.18.0, Rust 1.98.0 and pnpm are still pinned by the workflow itself. Until a trusted runner with the `diretta-sdk-149` label is registered, the SDK-enabled remote gate is defined and protected but not executable.

### Core deployment

The tar artifact carries:

- `bin/splayer-atom-core` launcher;
- `service/splayer-atom-core.service` template;
- `service/install-systemd.sh` installer;
- `docs/core-deployment.md` installation/upgrade/rollback guide;
- durable `data/` root;
- `runtime.json` runtime/protocol/capability/schema metadata.

See [`core-deployment.md`](./core-deployment.md) for the operator procedure.

## CI responsibilities

Existing upstream-oriented workflows continue to validate Desktop behavior. Atom's `Core System Gate` separately validates the Core flavor in a clean Ubuntu 24.04 runner with:

- Node `24.18.0`;
- Rust `1.98.0`;
- pnpm from the repository `packageManager` field and frozen lockfile;
- Core ALSA native dependencies only;
- Node/Web tests, typecheck, lint and upstream-touch audit;
- the same `build-core-system.ts` artifact pipeline used locally.

The Core workflow is a validation gate, not a release publisher. The first GitHub-hosted `Core System Gate` for commit `fd5671f` completed successfully on 2026-08-29 as Actions run `33245921866`; the follow-up CI/provisioning commit `6aac815` also passed as run `33246384095`, proving the ordinary no-SDK Core path remains green after the Diretta release-gate addition. Formal Atom artifact naming, updater/feed identity and release channels remain blocked on the product-identity roadmap work.

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
