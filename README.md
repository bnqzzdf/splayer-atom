<div align="center">

<img alt="SPlayer Atom logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>SPlayer Atom</h2>

<p>🎵 SPlayer-Next downstream focused on a Core-first architecture, unified Desktop/Web control, online lossless services, and strict HiFi Source Direct playback.</p>

<p>Continuously updated from the official <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> foundation.</p>

[![Stars](https://img.shields.io/github/stars/bnqzzdf/splayer-atom?style=flat)](https://github.com/bnqzzdf/splayer-atom/stargazers)
[![Release](https://img.shields.io/github/v/release/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/releases)
[![License](https://img.shields.io/github/license/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/issues)

**English** | [简体中文](./README.zh-CN.md)

</div>

---

> **SPlayer Atom downstream:** This repository is a downstream distribution of SPlayer-Next. SPlayer-Next remains the upstream foundation; its copyright and AGPL-3.0 notices are preserved. Atom deliberately keeps its product delta small and integrates official SPlayer updates instead of becoming a second independent player stack.

## Why SPlayer Atom?

SPlayer Atom keeps the SPlayer-Next desktop experience, media model, queue, library, lyrics, UI, and general-purpose playback foundation, then adds a small set of product capabilities that need a different ownership model or stricter HiFi guarantees.

| Area               | SPlayer-Next foundation                             | SPlayer Atom delta                                                                                                                      |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Application model  | Full-featured desktop player                        | Adds an ordinary **Node Core** that owns music-domain state and can run headless                                                        |
| Control surface    | Desktop renderer                                    | The same Vue experience can operate as **Desktop Control or Web Control** against the same Core protocol                                |
| Playback authority | Desktop-oriented playback lifecycle                 | Core owns the canonical queue, playback policy, source resolution, cache, preload/recovery, statistics, and output assignment           |
| Online music       | Existing SPlayer services and Netease compatibility | Adds **Qobuz** and **TIDAL** through the single Rust `streaming-api` protocol engine                                                    |
| Scrobbling         | Existing SPlayer integrations such as Last.fm       | Adds **ListenBrainz Core Scrobble / Now Playing**, isolated from the audio path and runtime-zero when disabled                          |
| Audio output       | General SPlayer audio engine and effects            | Adds **Diretta strict Source Direct** beside normal ALSA playback, without routing Direct audio through the normal float DSP path       |
| Deployment         | Desktop application                                 | Adds a Linux x86-64 Core artifact, Web Control, systemd deployment, migration/backup/rollback, and explicit runtime capability metadata |

Atom intentionally does **not** create a second media model, queue, provider framework, or audio engine. QQ Music and Kugou remain inherited compatibility surfaces rather than Atom-owned product paths.

## HiFi and Diretta Source Direct

Diretta in Atom is not another output backend attached to the normal SPlayer DSP pipeline. Selecting a `diretta:*` output activates a separate strict Direct runtime with a fail-closed rule: if the Target cannot accept the exact source-compatible format, playback fails instead of silently resampling or falling back to a processed path.

### What Direct preserves

- **PCM:** source sample rate, channel count, and every effective integer PCM sample bit/value. 24-bit PCM may be carried in a 32-bit transport slot only when the 24 valid bits remain unchanged.
- **Native DSD:** the logical one-bit sequence, DSD rate, and channel count. DSF/DFF layout repacking and per-byte bit reversal are allowed only as lossless container/wire-order adaptations.
- **No sample-changing processing:** no resampling, remixing, ReplayGain/normalization, EQ/preamp, software volume below unity, fade, tempo, pitch, re-encoding, PCM fallback, DoP, or DSD-to-PCM conversion.

The player validates these conditions before entering Direct mode and rejects later controls that would alter samples until Direct mode is exited.

### Memory and copy model

Source Direct is optimized for the smallest safe data path, but it is **not marketed as whole-chain zero-copy or whole-track RAM playback**:

- packed FFmpeg `S16` / `S32` frames use a **zero-copy fast path** from the decoded frame through the Direct ring to the Diretta SDK callback;
- planar PCM is interleaved into preallocated integer buffers with a **bit-perfect repack**;
- Native DSD uses preallocated buffers for DSF/DFF layout adaptation and, only when required by the Target, equivalent bit-order conversion;
- the Diretta SDK realtime pull callback only borrows the already prepared payload pointer and length; it does not copy or process audio samples;
- HTTP(S) Direct sources are materialized as exact response bytes into a local seekable temporary file instead of loading an entire track into RAM.

This lets Atom avoid touching audio data whenever the source is already in the required transport layout, while still supporting lossless codecs and formats whose decoded/container layout must be adapted without changing their audio meaning.

### Real-hardware validation

The current Diretta PCM and Native DSD paths have both passed real-hardware bit-perfect validation. PCM has been exercised through 768 kHz, with the supported lower sample-rate tiers also validated; Native DSD has been exercised through DSD512, with the supported lower DSD rates also validated. For PCM, the source data/format agreed with the active USB Audio stream reported by `/proc/asound/card0/stream0` and with the DAC display; Native DSD preserved its logical one-bit sequence on the real playback chain. A mixed PCM/DSD queue has also completed an overnight repeat run without playback or format-transition failures. The remaining hardware work is release-oriented lifecycle and final-artifact validation, tracked in [`docs/atom-roadmap.md`](./docs/atom-roadmap.md) and [`docs/hardware-release-checklist.md`](./docs/hardware-release-checklist.md).

## Core / Control / Output

```text
                   Desktop Control
                         │
                         │ Core Control Protocol
                         ▼
Web Control ───────► Node Core
                    ├─ database / settings / library
                    ├─ provider sessions / canonical queue
                    ├─ source resolution / cache / preload / recovery
                    ├─ ListenBrainz session authority
                    └─ output assignment / Diretta materialization
                              │
                              ▼
                         Core Local Output
                         ├─ ALSA
                         └─ Diretta Source Direct
```

Web and Desktop are Controls, not secondary domain authorities. Desktop-only window, tray, hotkey, updater, native-file, protocol, and lyric-window behavior stays a Host Capability; music-domain commands and snapshots use the same Core contract.

## Features inherited from SPlayer-Next

Atom continues to benefit from the broad SPlayer foundation, including:

- 🎵 **Broad format support** — MP3, FLAC, WAV, AAC, OGG, APE and more through FFmpeg/Rust
- 📝 **Rich lyrics** — LRC / QRC / YRC / TTML, word-by-word highlighting, translations, and native lyric surfaces
- 🌐 **Media servers** — Subsonic / Navidrome / Jellyfin / Emby
- 🖥️ **Desktop support** — Windows / macOS / Linux
- 🎚️ **Normal-output audio features** — FFT, normalization, EQ, speed/pitch, and fades outside Source Direct
- 🏷️ **Library and metadata tools** — local scanning, tag/cover editing, playlists, cache, and downloads
- 🎧 **System integration** — Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- 🎨 **Adaptive UI** — cover-based theming, Light / Dark / Auto, and the upstream SPlayer interface

## Online services

- **Netease** remains compatible through the established SPlayer TypeScript path and Atom Core ownership seams.
- **Qobuz** and **TIDAL** use the single native Rust `streaming-api` implementation; Core owns credentials/session policy and Controls only consume projections.
- **ListenBrainz** Scrobble and Now Playing are Core-owned. When disabled, no ListenBrainz child process, database handle, HTTP client, retry timer, or high-frequency listener is created; when enabled, its durable outbox and network work run in an isolated child process so they cannot block the audio path.
- **QQ Music / Kugou** remain frozen inherited compatibility surfaces and are not expanded as Atom-specific provider products.

Live-account acceptance status is intentionally kept in the roadmap rather than overstated here.

## Development

### Requirements

- **Desktop development:** Node.js `>=22.19.0` (matching the package engine constraint)
- **Formal Node Core builds:** Node.js `>=24.18.0 <25`; release reference runtime is `24.18.0`
- **pnpm** >= 10 (`packageManager` currently pins pnpm 11.x)
- **Rust toolchain** (required to build the native modules; see below)

### Native Modules

Native functionality is provided by Rust-based modules. The Desktop build retains the upstream platform modules, while the Linux Core artifact deliberately includes only the native runtime it needs.

| Module              | Role                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `audio-engine`      | N-API entry for the shared Rust audio engine; Core uses it for ALSA and optional Diretta Source Direct |
| `audio-engine-core` | Shared PCM/DSD decode, normal playback internals, strict Direct runtime, and Diretta integration       |
| `streaming-api`     | Atom's single native Qobuz/TIDAL protocol implementation                                               |
| `media-ctrl`        | Desktop system media controls + Discord Rich Presence                                                  |
| `taskbar-lyric`     | Native Windows taskbar lyric rendering                                                                 |

The formal Core `core-audio` flavor packages only `audio-engine.node` and `streaming-api.node`; it does not carry Electron/Chromium or Desktop-only native modules at runtime.

`pnpm dev` and `pnpm build` compile the native modules automatically. To skip them (e.g. when working only on the UI), set `SKIP_NATIVE_BUILD=true`.

### Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Start the dev app (builds native modules in debug, then launches Electron)
pnpm dev
```

### Building

```bash
pnpm build         # Full build: clean → native → typecheck → electron-vite

pnpm build:win     # Package for Windows
pnpm build:mac     # Package for macOS
pnpm build:linux   # Package for Linux (AppImage / deb / rpm / tar.gz / pacman)
```

> By default a build targets the current architecture only. Cross-compilation is not supported.

### Building Node Core

The ordinary technical Core build does not require the proprietary Diretta SDK:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts
```

A Diretta-branded Core build must explicitly provide the supported external Host SDK and request the Diretta gate:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

The SDK is not stored in this repository or bundled into release artifacts. See [`docs/build-flavors.md`](./docs/build-flavors.md) for the exact flavor/release rules and [`docs/core-deployment.md`](./docs/core-deployment.md) for systemd, data, migration, upgrade, and rollback behavior.

### Other Scripts

```bash
pnpm typecheck        # tsc + vue-tsc (node + web targets)
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # Build the Rust native modules only (add `--dev` for debug)
pnpm test             # Node + Web tests
pnpm test:native      # Rust workspace tests
```

For upstream synchronization and the rules that keep the Atom delta auditable, see [`docs/upstream-sync.md`](./docs/upstream-sync.md). Current product scope and acceptance gaps live in [`docs/atom-roadmap.md`](./docs/atom-roadmap.md).

## Acknowledgements

Special thanks to the open-source projects that make SPlayer-Next possible:

- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) — Apple Music-style lyrics display component library
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) — NetEase Cloud Music API (backup + enhanced)

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

- **Modification & distribution:** any modification or distribution must also be released under **AGPL-3.0**, with the complete source code provided.
- **Derivative works:** must adopt **AGPL-3.0** as well, and must retain this project's license and copyright notice in an appropriate place.
- **Attribution:** the original author and copyright information must be preserved. You may add your own notice for a derivative work, but you must not remove or alter the original.
- **Commercial use:** if used for sale or any other for-profit purpose, the source code and a link to the original project must be provided. Because this project relies on third-party services, commercial use may carry legal risk.
- **No warranty:** the software is provided "as is", without warranty of any kind, as described in the AGPL-3.0.

## Disclaimer

This project is intended for personal learning and research only, and must not be used for commercial or unlawful purposes. Some features rely on third-party APIs; users are solely responsible for ensuring their use complies with the relevant laws, regulations, and service agreements. The authors accept no liability for any direct or indirect consequences arising from the use of this project.
