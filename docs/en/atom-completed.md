# SPlayer Atom Completed Work

> Last updated: 2026-11-04

This is the completed-work archive for the [Roadmap](./atom-roadmap.md). A recorded test applies
only to its stated source commit, artifact and equipment. Remaining acceptance stays on the roadmap.

## Web + Core foundation

- Music-domain state, settings, library, queue, providers, playback policy, cache, downloads,
  statistics, plugins and output selection moved to Node Core. Web Control uses Core HTTP/WS
  commands, snapshots and events.
- Core sources moved under `core/**`; Electron runtime, preload/renderer IPC, window, tray,
  desktop lyrics, updater, desktop protocol, desktop-only crates and Windows/macOS packaging were
  removed. The Web Vite build and Linux x86-64 Core artifacts are the application path.
- The old Web `window.api`/Host compatibility layer and desktop-only capability branches were
  removed. Project-built native addons are `audio-engine.node` and `streaming-api.node`.
- ALSA, Diretta and UPnP enter the same Core playback authority. Core handles CUE/SACD virtual
  tracks. ListenBrainz sessions and its durable outbox are Core-owned; disabled mode starts no
  worker, while enabled SQLite/HTTP/retry work runs in an isolated child process.

## Audio and output implementation

- Diretta exact PCM Source Direct has real-target bit-perfect evidence through 768 kHz; Native
  DSD has real-target logical one-bit verification through DSD512. Mixed PCM/DSD queues completed
  an overnight transition run. See the [hardware checklist](./hardware-release-checklist.md).
- The ALSA HW backend implements Direct/Processed modes, exact PCM/Native DSD, lossy playback and
  existing PCM DSP. Core/Web mode and capability handling is integrated and CPAL output removed.
  The Web controls suppress Direct-only indicators and DSP actions when the actual path disallows
  them. Development-time ALSA listening and parameter checks were reported on 2026-09-22.
- On `cecee166`, FC4 hardware checks passed Direct PCM/DSD64 play, pause, seek and transitions;
  Processed PCM playback passed but seek failed. Independent USB submission comparisons matched
  1,414,748 PCM bytes and 5,658,992 DSD bytes. ALSA/Diretta switching, FC4 reconnect,
  systemd restart, SIGTERM and artifact WebSocket reconnection passed in their recorded scope.
  The clean Diretta archive matched all 220 installed non-data files and passed extracted-artifact
  smoke. See the [2026-09-22 record](./alsa-acceptance-2026-09-22.md).
- `c3e135ab` contains software fixes for the Processed seek and restart-to-play failures. Both
  passed FC4 retest on installed clean artifact `3e420f78`; see the
  [2026-09-23 record](./alsa-acceptance-2026-09-23.md). Shared `AlsaFrameWriter`,
  single runtime ownership and bounded decoded/DSP queues are now implemented; the
  [ALSA plan](./alsa-output-plan.md) and roadmap retain the clean-artifact/device acceptance.
- UPnP shares Core queue, source and cache flow; its CUE/SACD materialization is isolated from
  Direct/normal playback. The [UPnP plan](./upnp-output-plan.md) records AudioSys playback,
  extraction comparison and initial long-run evidence, as well as the outstanding stability gate.
- Direct CUE uses Core-owned staging and precise 75 fps boundaries with native gapless handoff.
  Automated checks are recorded in the [Direct CUE plan](./direct-cue-gapless-plan.md).

## Providers, Web and lyrics

- Core exposes credential-free session projections and provider capabilities for Netease, QQ Music,
  Kugou, Qobuz and TIDAL. QM/KG have Core-backed QR/manual Cookie login, search and collection
  pages, and Core source resolution with a plugin fallback. Qobuz has browser OAuth with a
  one-time callback listener and token-only login; Core persists the resulting session.
  `streaming-api` implements Qobuz protocol and TIDAL auth/request/manifest/DASH; Core integrates
  TIDAL JSON/BTS and DASH materialization. Selected real Netease/TIDAL UPnP online paths were
  recorded in the [UPnP plan](./upnp-output-plan.md). Full real-account acceptance for all five
  providers still follows the roadmap.
- Web Control exposes library, playlist, queue, playback, downloads, statistics, cache,
  providers, settings and plugins. The Core-owned Folder Browser now provides paged browsing,
  unscanned media and CUE/SACD access, scoped scan, pinned folders, search/filter, materials,
  list/grid views, recursive and batch actions, and shared containing-folder actions. The
  implementation is merged into `dev`; real-library UX acceptance is still open.
- The first batch of Folder Browser display sorting, physical file information and navigation
  improvements passed real-library/browser functional acceptance on 2026-09-28; wider NAS/USB,
  large-directory and materials acceptance remains open.
- Commits `75561bad` (2026-11-03) and `2041c17b` (2026-11-04) introduced indexed physical-path
  lookups, scoped partial-scan queries and demand-driven library projection refreshes, with
  automated regression coverage. Real-library performance acceptance is still open.
- An uncommitted UI-1 implementation on 2026-11-04 adds an AM-style player, three-way layout
  switching, local `player.layout` persistence with legacy `coverLayout` migration, and shared
  `PlayerTransport.vue` controls. Automated checks passed (Node 491/491, Web 159/159, types,
  lint and Web build). Browser screenshots and real-playback acceptance remain open; see the
  [upstream UI plan](../upstream-ui-adoption-plan.md) (Chinese only).
- Responsive Web layout has shared 768/1280 px breakpoints, mobile navigation, a compact player
  bar, adaptive lists, full player, settings and dialogs. Approved queue-drag and duplicate song-row
  double-click interactions were removed. Device acceptance is still open.
- Lyric P0/P1 is implemented: explicit-platform fallback, validated candidate selection,
  nonblocking TTML display upgrades, preferred-plugin competition and regression coverage for
  source quality and YRC/QRC/KRC/TTML spacing. See [lyric improvements](./lyric-improvements.md).

## Packaging groundwork

- Commit `85b5aa86` (2026-11-04) unified Node/Bun Core packaging, staging, artifact smoke and
  launcher paths, supporting system/bundled variants of each runtime. `mise.toml` pins Node
  `24.22.2` and Bun `1.4.4` (`0e590b43`). Bun has a separate-process plugin Host and a
  bounded empty-library API benchmark; target-hardware, long-run playback and release
  acceptance remain open. See the [runtime comparison](../bun-runtime-experiment.md) (Chinese only).
- Runtime compatibility checks, reference Node runtime, system/bundled variants and Linux CI
  packaging are in place. Staging checks native loading, plugin-host, HTTP/WS/Web startup and
  termination. Diretta packaging validates the required SDK; filenames include version and date.
- The Debian 11 bundled builder supports explicit no-Diretta or Diretta variants and
  checks native glibc requirements and artifact capabilities. On 2026-09-23, no-Diretta and
  Diretta v3 packages passed container builds and extracted-artifact smoke; all three packaged
  native modules required at most glibc 2.30. This was a dirty-tree software run, with no
  Diretta hardware result or v2/v4 build in that record. The historical test used SDK 150;
  the current build moved to SDK 148 in `0daa2cfd` and has no matching acceptance record here.
- Durable `data/`, migration backup, upgrade and rollback procedures are documented in
  [Core deployment](./core-deployment.md). A complete install/upgrade/rollback run on a fixed
  final candidate remains an open release gate.
