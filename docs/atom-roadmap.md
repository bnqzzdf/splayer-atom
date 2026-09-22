# SPlayer Atom Roadmap

## 1. Current status

SPlayer Atom is a Linux x86-64 music player adapted from SPlayer-Next and rebuilt around a
**Web + Core** model. The main architecture migration is complete. The ALSA HW backend now provides
explicit Direct / Processed PCM modes, Native DSD, retained lossy playback and existing PCM DSP
features, with Core/Web integration and no CPAL output. The user reported two days of actual ALSA
listening on 2026-09-22. Remaining audio work concerns the implementation gaps and separate hardware
evidence listed below, followed by final-artifact checks and release packaging.
Local hardware tests on the same commit confirmed Direct PCM/Native DSD playback and transitions,
but reproduced a Processed PCM seek failure; see the [hardware record](./hardware-release-checklist.md).
The two reproduced lifecycle defects now have software fixes in the development tree; their hardware
acceptance remains open until the fixed build is retested on the real output.

The release version is assigned when a release is prepared. Use the artifact's recorded Git commit
as the exact identity of a build; do not treat an RC version mentioned in planning or deployment
notes as a source revision.

Lasting constraints are defined in the repository's `AGENTS.md`; development and release workflows
are in the [development guide](./atom-development.md).

## 2. Core and Web foundation

- [x] Database, music-domain settings, library, queue, providers, playback, cache, downloads, statistics,
      plugins and output selection run in Node Core.
- [x] Web Control sends playback/library/provider commands through the Core HTTP/WS API and keeps
      its UI state synchronized with Core.
- [x] Project-built native addons are consolidated into `audio-engine.node` and `streaming-api.node`.
- [x] ALSA, Diretta Source Direct and UPnP use the same Core playback flow.
- [x] CUE/SACD virtual tracks and track boundaries are handled by Core.
- [x] ListenBrainz Now Playing/Scrobble runs in Core, with no background worker when disabled.

## 3. Completed Web + Core migration

- [x] Electron runtime/build dependencies and Electron-specific configuration are removed.
- [x] Core sources live under `core/**`.
- [x] Electron preload/renderer IPC, window/tray/hotkey/updater/desktop-protocol code is removed.
- [x] Desktop/taskbar/dynamic-island lyric windows and related Web branches are removed.
- [x] Desktop-only native crates are removed.
- [x] Windows/macOS packaging and CI jobs are removed.
- [x] Standalone Web Vite is the UI build.
- [x] Linux x86-64 Core artifacts are the application packaging path.
- [x] Web Control no longer installs the old `window.api`/Host compatibility layer.
- [x] Desktop-only capability branches and placeholder compatibility APIs are removed from Web.

## 4. Audio and output acceptance

- [x] Diretta exact PCM Source Direct has real-target bit-perfect evidence through PCM 768 kHz.
- [x] Native DSD Source Direct has real-target logical one-bit verification through DSD512.
- [x] Mixed PCM/Native-DSD Diretta queues have completed long-run transition testing.
- [x] UPnP playback uses the same Core queue/source/cache flow.
- [x] UPnP CUE/SACD extraction/materialization is isolated from normal and Direct playback.
- [x] Complete legacy ALSA playback coverage for common rate/channel/bit-depth combinations;
      this is not bit-perfect acceptance for the replacement path.
- [x] Implement one ALSA HW backend with shared device negotiation and frame writer for
      Direct / Processed PCM modes, exact PCM/Native DSD, retained lossy playback and PCM DSP;
      integrate Core/Web mode control and remove CPAL output and its dependency.
- [x] Adapt existing output selection, volume, EQ/tempo dialogs, player settings and shortcuts to
      Core-authoritative mode/capabilities; Direct must reject DSP controls and Processed PCM must
      never display a bit-perfect output indicator, including during switching and reconnection.
      Keep playback UI unobtrusive: no persistent technical status text; use an optional small icon
      or no indicator, with details available on demand.
- [x] Complete development-time ALSA listening and lifecycle acceptance: on 2026-09-22 the user
      confirms two days of actual use covering Direct / Processed PCM, PCM / Native DSD in their
      supported modes, pause, seek, track changes and output switching. Playback and seek worked
      correctly; `/proc/asound/.../stream0` output parameters were compared with the source and
      reported to match its sample rate and bit rate. This is hardware-parameter and listening
      evidence, separate from sample-by-sample bitstream verification and final-artifact checks.
- [x] Run local FC4 hardware checks through Core on commit `cecee166`: Direct 44.1 kHz/16-bit PCM
      and Native DSD64 play, pause/resume and seek correctly; PCM-to-DSD auto-next and DSD-to-PCM
      selection pass. Processed PCM playback also passes. See the
      [hardware record](./hardware-release-checklist.md) for actual negotiated formats and results.
- [ ] Hardware-retest the Processed PCM seek fix on FC4. The reproduced 30/60-second seek failure
      came from an intentional writer cancellation being reported as `outputFailed`, which cleared
      the negotiated processed output before seek commit. Intentional lifecycle shutdown no longer
      reports an output failure; recheck Processed seek and mode switching on the fixed build.
- [ ] Finish the remaining runtime/buffering work specified by the
      [ALSA output plan](./alsa-output-plan.md): Direct and Processed still have separate native
      lifecycle orchestration; Processed final gain/limiting/packing and buffer resizing still
      occur in the writer instead of the planned producer/preparation stage.
- [x] Compare real FC4 USB submission payloads against independently decoded PCM / parsed DSD:
      1,414,748 PCM bytes and 5,658,992 DSD bytes match exactly, with no capture loss or truncation.
      This verifies the captured USB submission layer, not the DAC's final digital output.
- [x] Recheck ALSA-to-Diretta PCM, Diretta Native DSD64 and Diretta-to-ALSA DSD64 on the installed
      clean `cecee166` artifact; all play and advance correctly, with ALSA released on Diretta.
- [ ] Obtain final-device ALSA bit-test/digital-capture evidence and repeat UPnP hardware checks;
      no UPnP renderer was discovered during this run.
- [x] Verify playing-time systemd restart, clean SIGTERM/device release, explicit playback after
      start, FC4 USB disconnect/reconnect recovery, and artifact WebSocket client reconnection.
- [ ] Hardware-retest restart-to-play on the fixed build. Core `play()` now reloads the restored
      queue when native state is `idle`, instead of forwarding Play to an unloaded native runtime.
- [x] Verify the clean Diretta archive against all 220 installed non-data files and pass the
      extracted-artifact smoke, including native/HTTP/Web/WS/session/restart/SIGTERM checks.
- [ ] Close final hardware acceptance after the reproduced seek/restart-to-play failures are fixed
      and remaining device/format checks pass. Detailed results and evidence boundaries are in
      [2026-09-22 acceptance](./alsa-acceptance-2026-09-22.md).

## 5. Provider acceptance

### Netease

- [x] Core provider/session/resolver and Web Control integration exist.
- [x] Complete real-account favorites/daily/cloud-library acceptance.
- [x] Complete continuous ALSA/Diretta/UPnP real-account playback acceptance.

### Qobuz

- [x] `native/streaming-api` is the Qobuz protocol implementation.
- [x] Core session/search/track/playback resolution is integrated.
- [ ] Complete real-account login/search/queue/playback/logout acceptance.

### TIDAL

- [x] `native/streaming-api` handles TIDAL auth/request/manifest/DASH.
- [x] Core session/search/JSON-BTS/DASH materialization is integrated.
- [x] Complete real-account auth/refresh/entitlement/logout acceptance.
- [x] Validate both JSON/BTS and DASH playback on final outputs.

### ListenBrainz

- [x] Core manages listen sessions and the durable outbox.
- [x] Disabled mode creates no ListenBrainz background worker.
- [x] SQLite/HTTP/retry work runs in the isolated child process when enabled.
- [x] Complete real-token Now Playing/permanent-listen/401/429/offline/restart acceptance.

## 6. Packaging and release

- [x] Runtime compatibility checks and a separate release reference runtime are implemented;
      current versions are listed in the [development guide](./atom-development.md#requirements).
- [x] system-runtime and bundled-runtime use the same Core JS/native/Web build.
- [x] Artifact staging validates native addon loading, plugin-host startup, HTTP/WS/Web startup and
      termination.
- [x] Durable `data/`, migration backup, upgrade and rollback procedures are defined.
- [x] Diretta packages fail before packaging when the required SDK is missing or mismatched.
- [x] Linux CI/build environment is pinned for release packaging.
- [x] Package filenames include the product version and build date.
- [x] Complete clean artifact, deployment, upgrade, rollback and hardware checks on one release
      candidate.

## 7. Web Control acceptance

- [x] Library, playlist, queue, playback, downloads, statistics, cache, providers, settings and
      plugins are available from Web Control.
- [x] Replace the current Web-built Folder tree with the complete
      [Core-owned Local Folder Browser](./local-folder-browser-plan.md): configured roots must be
      browsable immediately without a completed scan; ordinary unscanned audio must be playable;
      CUE/SACD must support on-demand virtual-track browsing/playback; recursive play/queue/playlist
      actions must be Core-owned and deterministic; Folder view must support scoped recursive
      scan/rescan through the single scanner authority; local Track actions must support
      Core-resolved “open containing folder” with ordinary/CUE/SACD focus; read-only supplementary
      album materials (images, PDF, and supported text/log files) must be browsable without turning
      Folder view into a file manager; pinned folders, physical folder/file-name search, explicit
      current-folder-only actions, navigation/viewer position restoration, and paginated/cursor
      browsing must be included; UX convergence must unify 播放 / 接下来播放 / 添加到队列 /
      添加到歌单…, simplify the Folder header/action menu, provide current-directory filtering
      distinct from recursive Folder Search, support list/cover-grid presentation, and expose
      Core-resolved “open containing folder” through the shared local Track action model in player,
      queue, SongList, playlist/album/artist, collection and history surfaces; offline roots,
      symlinks, long names, large directories, scan-time enrichment, and route restoration must
      meet the documented acceptance criteria; remove the old full-tree projection after migration.
      Core/Web implementation is now present on the Folder Browser feature branch, including
      paged direct-child filtering, list/grid presentation with lazy directory artwork, pinned
      folders/search/material viewers, shared containing-folder actions, single CUE/SACD split
      playlist insertion, realpath-bounded symlink handling shared with the native scanner, and
      anchor-based large-directory navigation restoration. Keep this item open until manual
      browser/NAS/USB acceptance and final merge are complete.
- [x] Validate multiple simultaneous Web Controls connecting/disconnecting/reconnecting to one Core.
- [x] Validate long-running Web Control use with playback continuing correctly across browser
      refreshes and reconnects.

## 8. Lyric quality work

The current lyric work is limited to the concrete P0/P1 correctness gaps identified against the
recent SPlayer changes. It does not include a parser or renderer replacement.

### P0

- [x] Make an explicit lyric-platform preference fall back through `lyricSourceOrder` when the
      preferred platform has no result; keep `self` strict.
- [x] Add one validated lyric-candidate commit path for online, plugin, local-TTML and preload
      results. A candidate must parse to valid lines before replacing the current lyric.
- [x] Prevent lower-ranked candidates, malformed TTML, and failed plugin results from clearing or
      replacing an already valid lyric. Preserve the explicit-platform-switch exception described
      in [`lyric-improvements.md`](./lyric-improvements.md).
- [x] Remove TTML waiting from streaming and preload display paths: show the base lyric first, then
      apply a token- and track-guarded background TTML upgrade. Download resolution remains
      synchronous so exported lyrics use the final usable result.
- [x] Let preferred plugin lyrics compete as soon as they return, using the same validity and
      format-quality gate as built-in sources.

### P1

- [x] Add loader and resolver regression tests for explicit-platform fallback, candidate quality
      ordering, malformed TTML preservation, streaming/preload non-blocking behavior, plugin
      takeover, and fast track changes.
- [x] Add YRC/QRC/KRC/TTML English word-spacing regression tests and verify TrackInfo, progress
      lyric text, and lyric copy output. Do not introduce a second whitespace representation unless
      the tests demonstrate a real Atom parser gap.

The detailed implementation boundary, call paths, acceptance criteria, and explicitly rejected
SPlayer changes are recorded in [`lyric-improvements.md`](./lyric-improvements.md).

## 9. Network scope

The current release is intended for a trusted home/LAN environment. Authentication, pairing, TLS,
and stricter browser-origin controls can be added later if remote/untrusted-network access becomes a
product goal.

## 10. Current priorities

1. Hardware-retest the Processed PCM seek and restart-to-play software fixes, then close the remaining ALSA runtime/buffering gaps
   against the output plan; dual-mode playback,
   Core/Web adaptation and CPAL removal are already implemented.
2. Finish final-device ALSA bitstream and outstanding UPnP hardware/format acceptance;
   USB submission comparison, Diretta switching, restart/SIGTERM/device reconnect and artifact
   smoke have passed within the recorded scope.
3. Finish Qobuz real-account acceptance.
4. Validate multiple simultaneous Web Control clients and long-running reconnect behavior.
5. Run the complete install/upgrade/rollback checklist against an artifact built from the intended
   Git commit.
6. After the acceptance gates pass, prepare the stable release from a clean, recorded Git commit.

## 11. Related documents

```text
docs/atom-development.md            development environment and common checks
docs/build-and-packaging.md         Core/Web build and packaging
docs/build-flavors.md               system/bundled and Diretta build variants
docs/core-deployment.md             systemd, data, migration, upgrade and rollback
docs/hardware-release-checklist.md  ALSA/Diretta/UPnP hardware acceptance
docs/live-provider-acceptance.md    provider real-account acceptance
docs/lyric-improvements.md          P0/P1 lyric correctness plan and technical design
docs/alsa-output-plan.md            shared ALSA backend, Direct/Processed PCM modes and UI design
docs/upnp-output-plan.md            UPnP output design
docs/local-folder-browser-plan.md   Core-owned local folder browsing and playback design
docs/native.md                      retained Rust/N-API modules
```
