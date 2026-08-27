# AGENTS.md

## SPlayer Atom mandatory downstream rules

These rules have priority over downstream architectural preferences. Preserve the upstream engineering conventions below unless an Atom rule explicitly constrains the design.

**SPlayer owns the architecture; Atom owns only the delta.** SPlayer Atom is a continuously updated downstream of SPlayer-Next. The default decision is always to reuse current upstream implementation, data models, stores, services, plugin hooks, and native interfaces. Atom must not create a parallel application architecture around SPlayer.

1. **Reuse before abstraction.** Before adding an Atom interface, registry, adapter, model, service, store, or state machine, inspect current upstream for an existing capability that can be reused directly.
2. **No speculative abstractions.** Add an Atom abstraction only when upstream lacks the capability, a real Atom requirement exists, and a concrete integration point cannot be served cleanly without it.
3. **Prefer upstream types.** Do not duplicate SPlayer media, queue, library, player, lyric, settings, transport, or persistence models unless a proven incompatibility requires a small extension type.
4. **Prefer thin integration over translation layers.** If Atom can call an upstream service/store/type directly, do that. Do not add ports/adapters merely for architectural symmetry.
5. **One source of truth.** Never maintain a second player, queue, library, settings state, or media model alongside SPlayer. Headless and compatibility surfaces must use the same upstream runtime state as the desktop UI.
6. **Delay domain creation.** Headless/Core, Zones, output-management layers, and similar concepts are not automatically first-class Atom domains. Promote them only after a real requirement proves upstream cannot represent them cleanly.
7. **Concrete first, generic later.** Implement the first real provider/output integration concretely against current upstream. Generalize only after repeated real duplication appears.
8. **No broad upstream surgery.** A feature requiring widespread edits across upstream pages, stores, services, or native modules is an architecture smell. Stop and redesign the seam before proceeding.
9. **Minimize upstream-owned edits.** Track upstream touch count, but never add wrappers merely to satisfy a file-count target.
10. **Legacy is an oracle, not architecture.** `/home/bnqzzdf/code/tinylms-next` and retained tinyLMS artifacts describe compatibility behavior; do not preserve recovered internal structure unless it remains a real Atom requirement.

For every feature, decide in this order: reuse current upstream → use an existing upstream hook → confirm a true Atom-specific gap → implement the smallest concrete delta → generalize only after repeated need.

The only currently confirmed major Atom-owned product deltas are Qobuz and Tidal capabilities missing from current upstream, plus Diretta output integration. Current upstream already owns NetEase, QQ Music, and Kugou; Atom must reuse those implementations rather than fork or duplicate them. Everything else remains subject to upstream inspection and may be reduced or omitted.

### Diretta Source Direct invariants

Diretta is not merely another SPlayer output backend. It is an Atom product-quality **Source Direct** path and may bypass upstream audio processing where that processing would alter source audio.

- Preserve the source sample rate, channel count, effective PCM bit depth/sample values, and native DSD payload whenever the selected Diretta Target supports them.
- Do not route strict Diretta playback through SPlayer's normal `f32` player resampler/DSP path. No resampling, remixing, EQ, normalization, software volume, fade, tempo, pitch, or re-encoding is allowed in Source Direct mode.
- Lossless codec decoding (for example FLAC/ALAC to the exact original PCM samples) is decoding, not transcoding. Padding into a wider integer transport slot is allowed only when sample bits remain unchanged. Native DSD must remain native DSD and must not be converted to PCM.
- If the Target cannot accept the exact direct format, do not silently fall back to processed audio. Fail the strict direct path or require an explicit non-direct mode outside the Source Direct claim.
- While Source Direct is active, any operation that would alter samples must be explicitly rejected rather than silently applied or used to leave Direct mode. This includes software volume below unity, normalization/ReplayGain, EQ/preamp, fade processing, tempo, and pitch. The caller must receive a clear Direct-mode error instructing the user to exit Source Direct first.
- The output hot path must avoid redundant sample copies. Prefer FFmpeg/Diretta-owned buffer borrowing or ref-counted frame ownership, with no heap allocation, mutex, logging, discovery, format negotiation, or business logic in the SDK real-time callback.
- `tinyLMS` is evidence, not the fidelity reference implementation. Reuse its proven Diretta protocol/lifecycle lessons, but reject its PCM normalization/resampling, whole-track RAM architecture, or unsafe buffer-lifetime assumptions when they conflict with these invariants.

Before merging architecture-affecting work, ask: could upstream do this directly; did we abstract before a real need; did we create a second source of truth; did we modify more upstream than necessary; can any new Atom layer be deleted without losing required behavior? For Diretta also ask: did any sample value, rate, channel layout, or DSD bitstream change between source decode and Target? If unnecessary structure or audio processing is found, simplify before continuing.

## Upstream repository guidance

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

SPlayer-Next — desktop music player on **Electron + Vue 3 + TypeScript**, with Rust native modules (NAPI-RS) for audio decoding, system media integration, and Windows taskbar lyric. Successor to SPlayer.

## Commands

```bash
pnpm install              # Install deps
pnpm dev                  # Build native (debug) + start Electron dev
pnpm build                # Full build (rimraf → native → typecheck → electron-vite)
pnpm build:{win,mac,linux}# Platform packages
pnpm typecheck            # tsc + vue-tsc (node + web targets)
pnpm lint / format        # ESLint / Prettier
pnpm build:native         # Rust only; add `--dev` for debug
```

`SKIP_NATIVE_BUILD=true` skips Rust during dev.

`audio-engine` static-links FFmpeg via the `ffmpeg_audio` crate (vendor zip + cc-built at compile time). Zero environment dependency — no `FFMPEG_DIR` / `PKG_CONFIG_PATH`, no system FFmpeg required.

## Shell

The development shell is Git Bash on Windows. Write all terminal commands in bash syntax (`&&`, `cd`, etc.) — no PowerShell-only constructs. File paths remain in Windows format (backslashes).

## Architecture

### Process Model

- **Main** (`electron/main/`) — windows, IPC, native modules
- **Preload** (`electron/preload/`) — `contextBridge` exposing `window.api` (player/config/system/library/streaming/lyrics)
- **Renderer** (`src/`) — Vue 3 SPA
- **Lyric windows** (`windows/desktop-lyric`, `dynamic-island`, `taskbar-lyric`) — independent Vue entries sharing `windows/shared/`

### Native Modules (Rust + NAPI-RS)

Four `.node` modules in `native/`, built via `scripts/build-native.ts`, lazy-loaded by `electron/main/utils/nativeLoader.ts`. NAPI-RS auto-generates `index.d.ts`, imported via path aliases `@splayer/audio-engine`, `@splayer/audio-capture`, `@splayer/media-ctrl`, `@splayer/taskbar-lyric`.

- `audio-engine` — `ffmpeg_audio` decode (static FFmpeg) + rodio playback + FFT + cover extraction. URLs wrapped as `Read + Seek` via `ffmpeg_audio::HttpAudioSource` (using `HttpCancelHandle` for cancellation/reset) — TLS handled in Rust (`reqwest` + `rustls`), cross-platform with no system deps. Pushes events (state/position/ended/outputStalled) via ThreadsafeFunction. Has load_token race protection and an `HttpCancelHandle` handle injected into `HttpAudioSource` for instant stop and reset.
- `audio-capture` — System sound / microphone capture for song recognition. Windows via WASAPI Loopback; Linux via PulseAudio (`libpulse-binding`, needs `libpulse-dev` at build time — CI `dev.yml`/`release.yml` install it). Collects 8 kHz mono f32 PCM.
- `media-ctrl` — Cross-platform system media controls (Windows SMTC / Linux MPRIS / macOS MPNowPlaying) + Discord RPC.
- `taskbar-lyric` — Windows taskbar lyric text rendering with RegistryWatcher / UiaWatcher / TrayWatcher.

### Playback Data Flow

```
User action → status store → IPC (player:load/play/pause/seek)
  → main process player.ts → audio-engine
  → Rust events (stateChanged/position/ended/outputStalled)
  → main broadcasts to renderer + syncs to media-ctrl
  → status store updates reactive state
  → playback.ts updates non-reactive time source
```

### State Management

Two-tier position tracking — high-frequency animation vs. low-frequency UI:

- `src/stores/status.ts` — Pinia reactive. `position / duration / state / volume`, pushed ~5Hz from main. Drives progress bar, time display, play button.
- `src/services/playback.ts` — Non-reactive plain vars. `getCurrentTime()` interpolates between pushes; `usePlaybackTime()` reads in RAF loop for 60fps lyrics/spectrum without Vue reactivity.
- `src/stores/media.ts` — Pinia + shallowRef. Current `Track` (lightweight) + `TrackDetail` (lyrics, quality). Only `track + activeLyric` persisted to sessionStorage; never persist `TrackDetail` (large lyric strings cause memory issues).

### Streaming Subsystem

Server protocol clients live in the main process (`electron/main/services/streaming/`): Subsonic / Jellyfin / Emby adapters, safeStorage-backed config, Jellyfin/Emby session management, SQLite synchronization, and the authenticated cover protocol. Subsonic family (Navidrome / OpenSubsonic / Airsonic / Gonic / LMS) shares one adapter; types differ only as UI labels.

- `electron/main/services/streaming/config.ts` — encrypted config and secret-free renderer views.
- `electron/main/services/streaming/connection.ts` — connection tests, connect, and authenticated adapter requests.
- `electron/main/services/streaming/coverProtocol.ts` — `streaming-cover://` proxy registered for the default and `persist:main` sessions.
- `electron/main/services/streaming/adapters/` — Server response → unified `Track / Album / Artist / Playlist`. Trusts server's artist field; no client-side splitting.
- `services/streaming/session.ts` — Jellyfin/Emby `/Sessions/Playing` heartbeat + PlaySessionId state machine; called from `core/player.ts`.
- `stores/streaming.ts` — Server list, active state, and complete shallowRef arrays; main-process update events trigger SQLite snapshot reloads, with no polling or direct media-server access.
- Credentials — `electron/main/services/streaming/config.ts` encrypts via Electron `safeStorage` to `{userData}/app-data/config/streaming.json`. `accessToken / userId` remain in the bounded main-process session cache and are re-acquired on connect.

### Lyric Windows

`windows/desktop-lyric`, `dynamic-island`, `taskbar-lyric` are independent Vue entries. Always use shared composables from `@windows/shared/`:

- `useNowPlayingSync` — playback sync, lyric index, anchor interpolation
- `getNowPlayingCurrentMs()` — non-reactive current time for RAF char highlight
- Line selection: `pickPrimaryIndex` (desktop, considers overlap) vs. `pickLatestStartedIndex` (dynamic island, immediate switch)

Don't reimplement these inside individual windows.

### Type System

- `shared/types/player.ts` — `Track`, `TrackDetail`, `Artist`, `Album`, `AudioQuality`, `PlayerState`, `PlayerStatus`, `PlayerEvent`, `LoadOptions`, `LoadResult`, `IpcResponse`
- `shared/types/lyrics.ts` — `LyricFormat`, `LyricSource (external | embedded | online)`, `LyricData`, `LyricLine`, `LyricWord`, `LyricSpan`
- `shared/types/platform.ts` — `Platform (netease | qqmusic | kugou)`
- `shared/types/streaming.ts` — `StreamingServerType`, `StreamingServerConfig`, `StreamingPingResult`, `StreamingAuthResult`, etc.

`Track` is for queue storage (no heavy data); `TrackDetail` loads on demand.

### Settings Schema

Declarative — defined in `src/settings/schema.ts`, types in `src/types/settings-schema.ts` (`SettingCategory → SettingSection → SettingItem`). Items bind via `{ store: "settings"|"theme", path: "nested.path" }`; `system.*` paths route through IPC to main config. Tag support on section/item via `SettingTag = { text; type? }` for Beta/experimental badges. i18n keys: `settings.section.{id}` / `settings.{itemKey}.{label,description}`.

### Data Storage

```
{userData}/app-data/        # Unified data directory, separate from Chromium cache data
├── config/
│   ├── settings.json       # Main config (electron/main/store/)
│   ├── streaming.json      # Streaming credentials (safeStorage encrypted)
│   └── lastfm.json         # Last.fm credentials (safeStorage encrypted)
├── database/library.db     # Music library (better-sqlite3, WAL)
├── cache/                  # covers/ (cover:// protocol) + artists/ backgrounds/ songs/
├── logs/                   # App logs + native/
└── plugins/                # scripts/ data/ logs/

# All paths are defined centrally in electron/main/utils/paths.ts
```

Renderer IndexedDB (localforage): `splayer/library`, `splayer/queue`. Local playlists are stored in
SQLite through the main-process playlist service; the old `splayer/playlists` store is migration-only.

### Cover Image

Rust extracts 300x300 JPEG thumbnail to `{userData}/app-data/cache/covers/` during decode; renderer reads via `cover://{filename}` protocol. Original via `getCoverRaw()` for SMTC, never cached. Authenticated streaming covers use the main-process `streaming-cover://` proxy.

### Config Store (Main)

`electron/main/store/` is custom (not electron-store). Reads/writes `{userData}/app-data/config/settings.json` (path via `electron/main/utils/paths.ts`), merges with defaults from `shared/defaults/settings.ts`. Supports dot-path access (`store.get("system.taskbarProgress")`), atomic writes, schema migrations.

### i18n

Renderer uses `vue-i18n` with `src/i18n/locales/{zh-CN,en-US}.json`. Main process has a lightweight translation table (`electron/main/utils/i18n.ts`) for tray/thumbar; locale synced via `system:setLocale` IPC.

### Path Aliases

```
@/                     → src/                   (renderer, tsconfig.web.json)
@shared/               → shared/                (both processes)
@main/                 → electron/main/         (main, tsconfig.node.json)
@windows/              → windows/               (lyric windows)
@splayer/audio-engine  → native/audio-engine    (main)
@splayer/media-ctrl    → native/media-ctrl      (main)
@splayer/taskbar-lyric → native/taskbar-lyric   (main)
```

## Conventions

### Comments — Chinese, with JSDoc

All comments in Chinese. Methods use standard JSDoc with `@param name - description` and
`@returns` when meaningful:

```ts
/**
 * <Chinese method description>
 * @param trackId - <Chinese parameter description>
 * @returns <Chinese return description>
 */
```

Forbidden: `// ───` separator lines (including ones with section titles), prose-style multi-paragraph comments, restating-the-obvious comments, numbered enumerations (`1. 2. 3.`) inside comments. Write comments only when the **why** is non-obvious.

### Code Organization

Split logic into files rather than separator comments. Don't extract a helper for one-place callers (3+ uses justify it). No "just in case" defensive code or fallbacks for impossible scenarios. No configurable knobs (timeouts / retries / buffer sizes) unless required — write constants. Don't break errors into per-case enums; `anyhow` or plain `Error` is usually enough.

### Memory Discipline

Memory is a hard requirement. The main process logs memory usage through `app.getAppMetrics()`
60 seconds after launch and then every 10 minutes. When a change touches rendering, caching, or
IPC, verify before and after with these samples.

- **Images by display size** — anything blurred, sampled, or rendered small uses the 300px `cover` thumbnail (player blur background, color extraction, lists). `coverOriginal` only for the visible large cover and poster export. Large `<img>`: add `decoding="async"`; preload with `img.decode()` before fading in.
- **Compositing layers are budgeted** — never put `will-change` in CSS on unbounded element collections; promote dynamically and only near the viewport (lyric engine `lineWillChange` pattern). New full-screen `filter: blur` / `backdrop-filter` layers need justification.
- **Hidden = silent** — high-frequency pushes (`position` / `fftData` / `position-sync`) must not reach hidden windows: `broadcast(channel, data, true)` or an `isVisible()` gate; consumers recover from the next push (≤200ms), no resync needed. Low-frequency state events (`stateChanged` / `ended` / track-change) always go through. RAF loops and canvases must stop when their surface is hidden (engine `freeze()` / `visibilitychange` pattern).
- **In-memory caches must be bounded** — every module-level Map/array cache needs an eviction rule (subsonic `viewAuthCache` evicts per-server). Never retain `TrackDetail`-sized data beyond the current track.

### Units

Frontend time is **milliseconds** everywhere. Rust engine uses seconds internally; `toMs()` in `electron/main/ipc/player.ts` converts.

### Types & Persistence

Never hand-write native module types — import from `@splayer/*`. Use `shallowRef` for `Track` arrays/collections (avoid deep proxy). Vue proxied objects can't be cloned by IDB (`DataCloneError`); use `toRaw` before persisting.

### Auto-imports

In Vue components, `vue / pinia / vue-router / @vueuse/core / vue-i18n` are auto-imported, and UI components in `src/components/` are auto-registered.
Icon components used only in Vue templates are auto-imported. Do not manually import them in
`<script setup>`; import an icon explicitly only when it is referenced by script code.

### Logging (Main Process)

Use scoped loggers from `@main/utils/logger` (`coreLog / playerLog / mediaLog / trayLog / taskbarLog / nativeLog`, etc.). Don't import `electron-log` directly.

### IPC Listeners

In preload's `onEvent`, always `ipcRenderer.removeAllListeners()` before adding a new listener (HMR accumulates otherwise). Renderer composables call the returned `unsubscribe` in `onBeforeUnmount`.

### Prettier

Double quotes, semicolons, 100-char width, trailing commas.

Before committing, run Prettier on every file included in the commit and verify the formatted
working tree before creating the commit. Do not leave formatting-only changes from the current task
outside the commit.

### Shared Types

Put cross-process types (`LocaleCode / SystemConfig / StreamingServerType`, etc.) in `shared/types/`.

### Commit Messages

Use Conventional Commits with a Chinese summary: `<type>: <summary>`. Keep the title on one line;
do not add a body or bullets unless explicitly requested. Use the type that matches the change,
such as `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `style`, or `chore`.
