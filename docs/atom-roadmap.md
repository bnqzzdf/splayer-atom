# SPlayer Atom Roadmap

## 1. Current status

SPlayer Atom is a Linux x86-64 music player adapted from SPlayer-Next and rebuilt around a
**Web + Core** model. The main architecture migration is complete. The next audio objective is a
complete ALSA output replacement with one backend and explicit Direct / Processed PCM modes,
including Native DSD, retained lossy playback and existing PCM DSP features.
Final hardware checks and release packaging follow that work; release timing does not reduce its scope.

Target release: **1.0.0-rc.3**.

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
- [ ] Implement the complete [ALSA output plan](./alsa-output-plan.md): one ALSA backend with
      Direct / Processed PCM modes, exact PCM/Native DSD, retained lossy playback and PCM DSP,
      Core/Web migration, and removal of the old CPAL output and duplicate lifecycle code.
- [ ] Adapt existing output selection, volume, EQ/tempo dialogs, player settings and shortcuts to
      Core-authoritative mode/capabilities; Direct must reject DSP controls and Processed PCM must
      never display a bit-perfect output indicator, including during switching and reconnection.
      Keep playback UI unobtrusive: no persistent technical status text; use an optional small icon
      or no indicator, with details available on demand.
- [ ] Obtain separate ALSA bitstream evidence and complete lifecycle/long-run acceptance for the
      replacement path; repeat affected Diretta and UPnP checks.
- [ ] Complete restart/SIGTERM/output-switch/reconnect lifecycle acceptance on the final artifact.
- [ ] Repeat the final hardware checklist from a clean release artifact.

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
- [ ] Complete clean artifact, deployment, upgrade, rollback and hardware checks on one release
      candidate.
- [ ] Publish the first 1.0 release candidate.

## 7. Web Control acceptance

- [x] Library, playlist, queue, playback, downloads, statistics, cache, providers, settings and
      plugins are available from Web Control.
- [ ] Validate multiple simultaneous Web Controls connecting/disconnecting/reconnecting to one Core.
- [ ] Validate long-running Web Control use with playback continuing correctly across browser
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

1. Complete the ALSA dual-mode design, existing UI adaptation and old-output removal as one
   implementation objective; retain DSP in the Processed PCM path.
2. Finish bitstream, restart/SIGTERM/output-switch/reconnect and long-run hardware acceptance.
3. Finish Qobuz real-account acceptance.
4. Validate multiple simultaneous Web Control clients and long-running reconnect behavior.
5. Run the complete install/upgrade/rollback checklist with the 1.0 RC artifact.
6. Publish `1.0.0-rc.3` after the acceptance gates pass, then prepare the 1.0 stable release.

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
docs/native.md                      retained Rust/N-API modules
```
