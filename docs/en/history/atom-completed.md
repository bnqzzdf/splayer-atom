# SPlayer Atom Completed Work

> Last updated: 2026-11-05

> Archived design or test record. For current status and outstanding acceptance, consult the [roadmap](../atom-roadmap.md).

This is the completed-work archive for the [Roadmap](../atom-roadmap.md). A recorded test applies
only to its stated source commit, artifact and equipment. The closeout below reflects the
maintainer's latest status; historical evidence later in this document retains its original scope.

## Roadmap closeout — 2026-11-05 (40 items)

The maintainer marked **all 40 items** in the latest Chinese roadmap as complete. They have
therefore been moved here rather than left in the active roadmap. Implementation and earlier
tests have traceable commits or records. For certain **newly checked hardware, real-account,
browser, endurance and release acceptance items**, no new supporting report was found in this
repository. Their status reflects the maintainer's declaration; this documentation-only update
does **not** independently rerun tests, create acceptance evidence, or attribute an older
artifact's results to v1.2.0.

### ALSA, Diretta and UPnP (9 items)

- [x] ALSA HW Direct/Processed, PCM/Native DSD, shared `AlsaFrameWriter`, single runtime
  ownership, bounded queues and scoped software smoke checks; see the [ALSA plan](./alsa-output-plan.md).
- [x] Historical FC4 Direct PCM/DSD and lifecycle checks on 2026-09-22, and Processed seek/
  post-restart playback retest on installed artifact `3e420f78` on 2026-09-23; see
  the [FC4 record](./alsa-acceptance-2026-09-23.md).
- [x] Diretta Source Direct real-target exactness through PCM 768 kHz and Native DSD512,
  plus an overnight mixed PCM/DSD queue; see the [hardware checklist](../hardware-release-checklist.md).
- [x] UPnP Core output and CUE/SACD materialization, historical AudioSys device checks,
  and 100 simulated early-disconnect regressions; see the [UPnP plan](./upnp-output-plan.md).
- [x] Diretta Direct CUE 75 fps boundaries, staged native gapless handoff and automated checks;
  see the [Direct CUE plan](./direct-cue-gapless-plan.md).
- [x] Maintainer-confirmed: ALSA changes validated in a clean candidate Core artifact,
  covering modes, formats, transitions and resource trends.
- [x] Maintainer-confirmed: target-device ALSA format, lifecycle and applicable
  precision-boundary checks completed.
- [x] Maintainer-confirmed: release-candidate UPnP real-renderer retest, long-run resource
  checks and compatibility matrix completed.
- [x] Maintainer-confirmed: real Diretta Target CUE gapless, PCM/DSD boundaries, seek,
  queue changes and endurance acceptance completed.

### Providers, ListenBrainz and Web Control (14 items)

- [x] Core/Web integration, sessions, search and relevant protocol paths for Netease, QM,
  KG, Qobuz and TIDAL.
- [x] ListenBrainz Now Playing, permanent listens, durable outbox, retries, isolated
  worker and automated checks.
- [x] Responsive Web 768/1280 px breakpoints, mobile navigation, lists, player,
  settings and dialogs.
- [x] Multi-WebSocket-client and reconnect smoke checks on a Core artifact.
- [x] UI-1 AM player, three-way layout switching, legacy preference migration and
  shared controls, `09aa92f1`.
- [x] Maintainer-confirmed: UI-1 browser/device acceptance across viewports, uninterrupted
  playback, lyrics/queue, hidden-tab recovery and Direct controls.
- [x] UI-2 normal/compact rows, virtual-height adjustments, scoped sorting and automated
  regression tests, `125f35a8`.
- [x] Maintainer-confirmed: UI-2 browser acceptance for long lists, disc grouping,
  current-track positioning, mobile touch, density changes and sort restoration.
- [x] FIX-1 nested scan-root rejection before Core mutation, without Web rollback
  removal, `b2a6b1e9`.
- [x] FIX-2 download audio extension recovery from response filenames, `56b41611`.
- [x] Maintainer-confirmed: five-provider full real-account acceptance.
- [x] Maintainer-confirmed: ListenBrainz real-token, 401/429, offline retry and restart acceptance.
- [x] Maintainer-confirmed: responsive Web interactions on representative mobile devices.
- [x] Maintainer-confirmed: multiple real Web Controls in prolonged refresh/disconnect/
  reconnect operation.

### Folder browsing (10 items)

- [x] Core Folder Browser pagination, pinned directories, search/filter, list/grid,
  CUE/SACD, materials, scoped scanning, recursive/batch actions and "Show in folder".
- [x] First-batch Core display sorting, physical attributes, pinned grouping,
  sorting before pagination and cursor validation.
- [x] First-batch Web sorting preferences, history restoration, per-directory filtering,
  back navigation and list/grid preferences.
- [x] First-batch physical filenames, action scope hints, full-result selection and search truncation.
- [x] First-batch real-library functional acceptance on 2026-09-28, including pagination over
  200 entries, filtering and CUE/SACD positioning (Node 428/428, Web 111/111 at the time).
- [x] Maintainer-confirmed: wider NAS/USB, very large directory and materials-viewer acceptance.
- [x] Maintainer-confirmed: Folder Search latency investigation and subsequent decision completed.
- [x] Physical-path queries, partial scans and demand-driven projection optimizations,
  `75561bad` and `2041c17b`.
- [x] Second-batch subtree search, folder album/artist shortcuts and batch failure notices,
  `b65bcd91`.
- [x] Maintainer-confirmed: second-batch real-library/browser acceptance.

### Builds and release (7 items)

- [x] Shared Node/Bun Core and four system/bundled Flavor builds, staging, smoke and
  basic plugin Host checks, `85b5aa86`; Node 24.22.2 / Bun 1.4.4 pinned in `mise.toml`.
- [x] 2026-11-04 empty-library Node/Bun API benchmarks and real-library basic loading,
  FLAC playback and track-switch comparisons.
- [x] Historical Debian 11 bundled no-Diretta and Diretta v3 container-build and
  extracted-artifact smoke checks on 2026-09-23 (then SDK 150).
- [x] Product version `1.2.0`, commit `5b8773c3` and Git tag `v1.2.0`
  pushed to GitHub; a Git tag does not itself create a GitHub Release.
- [x] Maintainer-confirmed: experimental Bun target formats/outputs, seek and switching,
  plugin Host, endurance, Debian 11/OpenRC, upgrade and rollback acceptance.
- [x] Maintainer-confirmed: final clean build from the target commit, hardware/deployment
  checklists, installation, upgrade and rollback acceptance.
- [x] Maintainer-confirmed: stable-release preparation and artifact commit, hash,
  capabilities and acceptance records completed. No additional GitHub Release
  was created as part of this documentation update.

Completed items are no longer active roadmap tasks. Earlier plans and statements that
acceptance was pending should be interpreted in the context of their original dates.

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
  an overnight transition run. See the [hardware checklist](../hardware-release-checklist.md).
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
- UI-1 commit `09aa92f1` adds an AM-style player, three-way layout
  switching, local `player.layout` persistence with legacy `coverLayout` migration, and shared
  `PlayerTransport.vue` controls. Automated checks passed (Node 491/491, Web 159/159, types,
  lint and Web build). Browser screenshots and real-playback acceptance remain open; see the
  [upstream UI plan](../../history/upstream-ui-adoption-plan.md) (Chinese only).
- UI-2 adds normal/compact song rows (88px/56px), virtual-list remeasurement, fixed page-scope
  sorting preferences and legacy global-sort cleanup, with persistence and isolation tests.
  Browser scrolling, disc grouping and touch-target acceptance remain open.
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
  acceptance remain open. See the [runtime comparison](../../history/bun-runtime-experiment.md) (Chinese only).
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
  [Core deployment](../core-deployment.md). A complete install/upgrade/rollback run on a fixed
  final candidate remains an open release gate.
