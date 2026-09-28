# SPlayer Atom

> Last updated: 2026-09-28

[简体中文](./README.md) · **English**

SPlayer Atom is a Linux x86-64 music player built on [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next), using a **Node Core + Web Control** architecture: the background Core owns the library, online services, playback queue, and audio outputs, while everyday operation happens in the browser.

The Core runs as a long-lived process, which suits Linux hosts, music servers, and HiFi hosts that stay powered on to play music; a computer, tablet, or phone can connect to the same Core at the same time and see the same playback state in real time. Closing the browser page does not interrupt playback.

## Runtime architecture

```text
        Computer / tablet / phone browser (multiple may connect at once)
                                │ HTTP + WebSocket (default :14558)
                                ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │ SPlayer Atom Node Core (long-running process)                         │
        │                                                                       │
        │ Web Control static page (renderer/, served by the Core itself)        │
        │ HTTP API + WS event push (core/server, atom)                          │
        │ Library / scan / settings / queue / cache / downloads                 │
        │ Online platform access (core/apis)                                    │
        │ Self-hosted media services (8 Subsonic/Jellyfin-family types)         │
        │ Plugin host — separate child process                                  │
        │ ListenBrainz — separate child process (no background work when off)   │
        └───────────────────────┬───────────────────────────────────────────────┘
                                │ napi
        ┌───────────────────────▼───────────────────────────────────────────────┐
        │ Native addons (Rust)                                                  │
        │ audio-engine    decode, ALSA, Diretta, DSD,                           │
        │                 CUE / SACD virtual tracks, DSP                        │
        │ streaming-api   Qobuz / TIDAL protocol and streaming                  │
        │ diretta-sys     Diretta Host SDK bindings and compatibility layer     │
        └───────────────────────┬───────────────────────────────────────────────┘
                                ▼
        Output backends: ALSA · Diretta Source Direct · UPnP Renderer
```

### Component responsibilities

- **Node Core** (`core/`): where the single authoritative state lives. Library and SQLite database, scanning, settings, playback queue and playback policy, source resolution, cache and preload, downloads, online platform sessions and credentials, plugin runtime, listening statistics, output devices, and Diretta passthrough. It exposes only HTTP/WS interfaces (`core/server/`, `core/atom/headless/`); playback decisions are not handed to the browser.
- **Web Control** (`src/`): the UI written with Vue 3 + TypeScript + Pinia + vue-router + vue-i18n + UnoCSS, whose build output `out/renderer/` is served directly by the Core, so the frontend needs no separate deployment. It only sends high-level commands and consumes the snapshots and events pushed by the Core.
- **Native addons** (`native/`): `audio-engine` handles decoding and audio output (ALSA, Diretta, DSD, CUE/SACD virtual tracks, and EQ/loudness/tempo processing), `streaming-api` handles the native Qobuz / TIDAL protocols and streaming, and `diretta-sys` binds the Diretta Host SDK and provides a compatibility shim for older glibc.
- **Shared contracts** (`shared/types/`): type definitions shared across processes and between frontend and backend, the only interface contract between Core and Web.
- **Scripts and packaging** (`scripts/atom/`, `docker/`): build, packaging, artifact self-check, release tag, and hardware acceptance scripts, plus the Debian 11 containerized build.

### Data and persistence

`data/` under the installation root is **durable state** and must be preserved during an upgrade:

| Location                   | Contents                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `data/database/`           | SQLite library and playback history (better-sqlite3)                                                                           |
| `data/config/`             | Settings, online platform sessions and credentials                                                                             |
| `data/backups/migration-*` | Snapshots taken before a schema migration (created only when a migration is actually needed)                                   |
| Cache directory            | Rebuildable content such as cover and audio caches, following the Core XDG cache path, not placed inside the installation root |
| `data/logs/`               | Core and native runtime logs (production also writes to stdout, owned by journald)                                             |
| `data/plugins/`            | Plugin scripts together with their own data and logs                                                                           |

The Core rejects a database or settings schema newer than the current build; production logs go to stdout/stderr and are taken over by systemd/journald.

## Capabilities

**Local library**

- Directory scanning and incremental updates, scan progress push; search, album/artist aggregation
- Tag editing, folder browsing and pinning, CUE virtual tracks, SACD stereo virtual tracks
- Lyrics: local TTML lyric library, matching, bilingual/word-by-word scrolling and offset adjustment (supports LRC/QRC/YRC/KRC/TTML/LyS/SRT/ASS)
- Personal FM, daily recommendations, cloud drive, song comments

**Online services**

- Access and login for five platforms: Netease Cloud Music, QQ Music, Kugou Music, Qobuz, TIDAL
  (QR code / Cookie / browser OAuth; credentials and playback URLs are held by the Core, and the Web side keeps a read-only projection)
- Platform home pages: charts, new album releases, popular artists, section "view all"; online images are proxied and cached through the Core
- Self-hosted media services: Subsonic / Navidrome / OpenSubsonic / Airsonic / Gonic / LMS / Jellyfin / Emby access, search, and sync
- Metadata completion such as artist avatars (MusicBrainz)

**Playback and output**

- ALSA output; the normal PCM path provides DSP features such as EQ, loudness, and tempo
- **Diretta strict Source Direct**: source sample rate, channel count, effective bit depth, and samples pass through unchanged, and Native DSD keeps its logical one-bit sequence; never silently resamples, remixes, applies DSP, or falls back to PCM, and never goes through the `f32` DSP/resampler path
- UPnP single-Renderer output, sharing the same queue and source resolution pipeline as local output
- Queue and play modes, gapless playback (CUE and ordinary track splits), preload and cache

**Runtime and operations**

- Plugin runtime: a single host child process carries all plugins (heartbeat and crash recovery), compatible with LX `user_api` scripts, declaring capabilities via `@apiLevel` / `@grant`
- ListenBrainz: Now Playing and Scrobble, in a separate child process, with no background work when disabled
- Download management, playback statistics, cache management, network proxy settings; the `/debug` diagnostics page (showing Core connection and playback chain status)
- Real-time sync across multiple clients: every Web Control shares the Core's queue and playback state. State changes are pushed over WS in real time
  (`status`, `libraryChanged`, `providerSessions`, `downloadProgress`, etc.); per-frame playback progress does not go over WS,
  but instead polls `/api/status` every 500ms while the page is visible, avoiding pushing high-frequency events to all clients

**Boundaries and constraints**

- Host media files belong to the user: Atom provides no command or UI that deletes music files, and cleanup only covers the cache/temporary/partial files it produces itself
- Under strict Diretta no sample-altering processing is performed; unsupported Target formats fail explicitly instead of silently falling back

## Requirements

- Linux x86-64
- Node.js `>=22.19.0` (**formal builds are pinned to 24.18.0**, hard-validated by the build script)
- pnpm `>=10`
- Rust stable
- ALSA development headers, Clang, pkg-config

On Ubuntu/Debian-style systems:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y \
  libasound2-dev pkg-config clang
```

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` first builds the debug native addons, then starts Node Core and the Web Vite development server.

Common checks:

```bash
pnpm typecheck
pnpm test               # Node contract tests + Web unit tests
pnpm lint
pnpm build
cargo check --workspace
cargo test --workspace
pnpm docs:build
pnpm docs:stamp:check   # whether documentation timestamps need refreshing
```

## Build

```bash
pnpm build
```

Full build order: build `audio-engine.node` and `streaming-api.node` → Node/Web typecheck → bundle Node Core → build Web Control. Individual targets:

```bash
pnpm build:native
pnpm build:core
pnpm build:web
```

## Packaging and deployment

```bash
pnpm package:core            # system-runtime: relies on the host Node
pnpm package:core:bundled    # bundled-runtime: ships the reference Node in the archive
```

Artifacts are written to `out/`, with the version, commit, build time, and Diretta variant in the filename:

```text
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-{system,bundled}-linux-x64.tar.gz
```

A formal Diretta build must explicitly provide a supported Host SDK (choose the highest variant `v2` / `v3` / `v4` / `zen4` for the target CPU):

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --diretta-variant=v2
```

The archive's **top level is the installation root**, so extracting it into the target directory is enough (no `--strip-components` needed). See [Core deployment and upgrades](./docs/en/core-deployment.md) for systemd, data directories, and the upgrade and rollback flow.

## Documentation

- [User guide](./docs/en/guide.md)
- [Core deployment and upgrades](./docs/en/core-deployment.md) (systemd, data directories, upgrades, rollback)
- [Build and packaging](./docs/en/build-and-packaging.md) · [Build flavors](./docs/en/build-flavors.md) · [CPU variants](./docs/cpu-variants.md) (Chinese only)
- [Development setup](./docs/en/atom-development.md) · [Roadmap](./docs/en/atom-roadmap.md) · [Completed work](./docs/en/atom-completed.md)
- [Native modules](./docs/en/native.md) · [Qobuz / TIDAL Rust protocol engine](./docs/streaming-rust-guide.md) (Chinese only)
- [Plugin development](./docs/en/plugins/) · [Plugin usage](./docs/en/plugins-usage.md) · [Type reference](./docs/en/types.md)
- [Hardware release acceptance](./docs/hardware-release-checklist.md) (Chinese only) · [Live provider acceptance](./docs/live-provider-acceptance.md) (Chinese only)

English documentation lives in [`docs/en/`](./docs/en/); the documentation site source is in [`docs/`](./docs), and `pnpm docs:dev` previews it locally.

## License

GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).
