<div align="center">

<img alt="SPlayer Atom logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>SPlayer Atom</h2>

<p>🎵 An independent downstream distribution of SPlayer-Next, focused on a Core-first architecture, unified Desktop/Web control, online lossless services, and strict HiFi Source Direct playback.</p>

<p>Continuously updated from the official <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> foundation.</p>

[![Stars](https://img.shields.io/github/stars/bnqzzdf/splayer-atom?style=flat)](https://github.com/bnqzzdf/splayer-atom/stargazers)
[![Release](https://img.shields.io/github/v/release/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/releases)
[![License](https://img.shields.io/github/license/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/bnqzzdf/splayer-atom)](https://github.com/bnqzzdf/splayer-atom/issues)

**English** | [简体中文](./README.zh-CN.md)

</div>

---

> **SPlayer Atom downstream:** SPlayer Atom is an independently maintained downstream distribution built from SPlayer-Next. It is not SPlayer-Next itself and does not represent the upstream project. SPlayer-Next is Atom's official upstream, and its copyright and AGPL-3.0 notices are preserved. Atom maintains its own Core / Control / Output product architecture, HiFi implementation, and release cadence while keeping the long-term downstream delta auditable.

## Why SPlayer Atom?

SPlayer Atom inherits the mature Desktop, media, lyrics, library, and UI foundation from SPlayer-Next, then builds its own Core-first product architecture, Headless/Web Control, online services, and strict Source Direct audio path on top. Atom is a downstream product that continuously integrates upstream work; its README, branding, architecture, and releases describe Atom rather than presenting it as SPlayer-Next.

| Area               | SPlayer-Next foundation                             | SPlayer Atom delta                                                                                                                      |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Application model  | Full-featured desktop player                        | Adds an ordinary **Node Core** that owns music-domain state and can run headless                                                        |
| Control surface    | Desktop renderer                                    | The same Vue experience can operate as **Desktop Control or Web Control** against the same Core protocol                                |
| Playback authority | Desktop-oriented playback lifecycle                 | Core owns the canonical queue, playback policy, source resolution, cache, preload/recovery, statistics, and output assignment           |
| Online music       | Existing SPlayer services and Netease compatibility | Adds **Qobuz** and **TIDAL** through the single Rust `streaming-api` protocol engine                                                    |
| Scrobbling         | Existing SPlayer integrations such as Last.fm       | Adds **ListenBrainz Core Scrobble / Now Playing**, isolated from the audio path and runtime-zero when disabled                          |
| Audio output       | General SPlayer audio engine and effects            | Adds **Diretta strict Source Direct** and Core-owned **UPnP MediaRenderer** output; Direct audio never enters the normal float DSP path |
| Virtual media      | Regular local files / baseline CUE support          | Core-owned CUE virtual tracks, SACD stereo virtual tracks, track-end boundaries, and UPnP extraction/materialization                    |
| Deployment         | Desktop application                                 | Adds a Linux x86-64 Core artifact, Web Control, systemd deployment, migration/backup/rollback, and explicit runtime capability metadata |

Atom intentionally does **not** create a second media model, queue, provider framework, or audio engine. QQ Music and Kugou remain inherited compatibility surfaces rather than Atom-owned product paths.

## HiFi and Diretta Source Direct

Diretta in Atom is not another output backend attached to the normal SPlayer DSP pipeline. Selecting a `diretta:*` output activates a separate strict Direct runtime with a fail-closed rule: if the Target cannot accept the exact source-compatible format, playback fails instead of silently resampling or falling back to a processed path.

### What Direct preserves

- **PCM:** source sample rate, channel count, and every effective integer PCM sample bit/value. 24-bit PCM may be carried in a 32-bit transport slot only when the 24 valid bits remain unchanged.
- **Native DSD:** the logical one-bit sequence, DSD rate, and channel count. DSF/DFF layout repacking and per-byte bit reversal are allowed only as lossless container/wire-order adaptations.
- **No sample-changing processing:** no resampling, remixing, ReplayGain/normalization, EQ/preamp, software volume below unity, fade, tempo, pitch, re-encoding, PCM fallback, DoP, or DSD-to-PCM conversion.

The player validates these conditions before entering Direct mode and rejects later controls that would alter samples until Direct mode is exited.

### Basis for the HiFi claim

Atom's Source Direct claims are limited to verifiable digital-signal facts: **whether sample values / the logical DSD bit sequence, sample rate, or channel count change, and whether DSP, resampling, or format fallback occurs.**

Keeping data resident in memory, reducing memory copies, or lowering CPU/I/O activity can be useful engineering optimizations for performance, realtime behavior, and stability, but Atom **does not present “pure-memory playback”, “zero-copy”, or fewer data copies as a source of better sound quality**. If the digital samples remain identical and playback has no underrun or dropout, whether the bytes came from a file cache or RAM, or passed through a correct lossless memory copy, is not itself evidence of improved audio quality.

Strict Direct therefore aims to keep every required decode, layout adaptation, or transport repack audio-content preserving, while completely bypassing processing that would unnecessarily alter the signal.

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
                         Core Output
                         ├─ ALSA
                         ├─ Diretta Source Direct
                         └─ UPnP MediaRenderer
```

Web and Desktop are Controls, not secondary domain authorities. Desktop-only window, tray, hotkey, updater, native-file, protocol, and lyric-window behavior stays a Host Capability; music-domain commands and snapshots use the same Core contract.

## Foundation inherited from upstream SPlayer-Next

As a downstream distribution of SPlayer-Next, Atom directly inherits and continuously integrates a broad set of mature upstream capabilities, including:

- 🎵 **Broad format support** — MP3, FLAC, WAV, AAC, OGG, APE and more through FFmpeg/Rust
- 💿 **Virtual tracks** — CUE and SACD stereo areas can be expanded into stable virtual tracks, with CUE start/end boundaries owned by the Core playback lifecycle
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
pnpm build:unpack  # Build an unpacked Electron directory for local acceptance / ELF dependency inspection

pnpm build:win     # Package for Windows
pnpm build:mac     # Package for macOS
pnpm build:linux   # Package Linux Desktop; currently tar.gz only
```

> By default a build targets the current architecture only. Cross-compilation is not supported.

> **Linux ABI note:** both Desktop and Core contain Rust/N-API native binaries. A local Linux build can inherit the glibc ABI available on the build host. Building on a rolling distribution or a glibc 2.43 host may therefore produce files that actually require `GLIBC_2.43` and fail on older systems. Public Linux artifacts should be built in a pinned older builder/sysroot and the final ELF files should be scanned for their highest `GLIBC_x.y` symbol version. See [`docs/en/build-and-packaging.md`](./docs/en/build-and-packaging.md).

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

The complete Desktop/Core build chain, packaging targets, Diretta build rules, Linux glibc compatibility guidance, and artifact checks are documented in [`docs/en/build-and-packaging.md`](./docs/en/build-and-packaging.md).

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

First and foremost, thanks to [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) and its maintainers and contributors. SPlayer-Next is the official upstream of SPlayer Atom, and Atom's Desktop, media model, lyrics, library, UI, and much of its general player foundation come directly from that project. Atom continues those foundations as an independently maintained downstream distribution while preserving the applicable copyright and AGPL-3.0 notices.

We also thank the open-source projects used by SPlayer-Next and Atom, including:

- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) — Apple Music-style lyrics display component library
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) — NetEase Cloud Music API (backup + enhanced)

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

- **Commercial use:** AGPL-3.0 does not prohibit commercial use. Commercial and non-commercial use, modification, distribution, and network deployment of modified versions must comply with the source-availability, notice, and network-use requirements of AGPL-3.0.
- **Modifications and derivatives:** modified or derivative versions of this project must continue to comply with AGPL-3.0 and preserve the applicable copyright, license, and attribution notices.
- **Third-party components:** Diretta, Qobuz, TIDAL, and other third-party services, APIs, SDKs, media, or brands are governed by their own licenses, developer terms, and service agreements. This repository's AGPL-3.0 license does not grant rights to use, redistribute, or commercially license those third-party materials.
- **Diretta SDK:** the proprietary Diretta SDK is not part of this repository and will not be distributed with the project as a prebuilt artifact. Users who need that integration must obtain the SDK, credentials, and any required permissions directly from the relevant rights holder.
- **Source distribution:** this project is currently maintained and distributed as source code and does not promise precompiled release artifacts.
- **No warranty:** the software is provided "as is", without warranty of any kind, as described in AGPL-3.0.

## Disclaimer

Users are responsible for ensuring that their use, modification, or distribution of this project complies with applicable law, AGPL-3.0, and the licenses or terms governing any third-party services, APIs, SDKs, content, or devices they choose to use. This project provides no third-party authorization, service-availability guarantee, or compliance assurance. To the extent permitted by law, the authors accept no liability for direct or indirect consequences arising from use of the project or its third-party integrations.
