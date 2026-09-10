# SPlayer Atom Roadmap

## 1. Current status

SPlayer Atom is a Linux x86-64 music player adapted from SPlayer-Next and rebuilt around a
**Web + Core** model. The main architecture migration is complete. Current work is focused on final
hardware checks, multi-client Web testing, provider acceptance, and release packaging.

Target release: **1.0.0-rc.1**.

- **Node Core** runs the music library, settings, providers, queue, playback, cache, downloads,
  plugins, statistics and audio outputs.
- **Web Control** is the browser UI and communicates with Core over HTTP/WebSocket.
- **Linux x86-64** is the supported release platform.

## 2. Core and Web foundation

- [x] Database, settings, library, queue, providers, playback, cache, downloads, statistics,
      plugins and output selection run in Node Core.
- [x] Web Control sends playback/library/provider commands through the Core HTTP/WS API and keeps
      its UI state synchronized with Core.
- [x] Core native runtime is limited to `audio-engine.node` and `streaming-api.node`.
- [x] ALSA, Diretta Source Direct and UPnP use the same Core playback flow.
- [x] CUE/SACD virtual tracks and track boundaries are handled by Core.
- [x] ListenBrainz Now Playing/Scrobble runs in Core, with no background worker when disabled.

## 3. Web + Core migration

- [x] Electron runtime/build dependencies and Electron-specific configuration are removed.
- [x] Core sources live under `core/**`.
- [x] Preload/IPC/window/tray/hotkey/updater/desktop-protocol code is removed.
- [x] Desktop/taskbar/dynamic-island lyric windows and related Web branches are removed.
- [x] Desktop-only native crates are removed.
- [x] Windows/macOS packaging and CI jobs are removed.
- [x] Standalone Web Vite is the UI build.
- [x] Linux x86-64 Core artifacts are the application packaging path.
- [x] Web Control no longer installs the old `window.api`/Host compatibility layer.

## 4. Audio and output acceptance

- [x] Diretta exact PCM Source Direct has real-target bit-perfect evidence through PCM 768 kHz.
- [x] Native DSD Source Direct has real-target logical one-bit verification through DSD512.
- [x] Mixed PCM/Native-DSD Diretta queues have completed long-run transition testing.
- [x] UPnP playback uses the same Core queue/source/cache flow.
- [x] UPnP CUE/SACD extraction/materialization is isolated from normal and Direct playback.
- [x] Complete final release-candidate ALSA coverage for common rate/channel/bit-depth combinations.
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

- [x] Core runtime range is Node `>=24.18.0 <25`; release reference is `24.18.0`.
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
- [x] Desktop-only capability branches and placeholder compatibility APIs are removed from Web.
- [ ] Validate multiple simultaneous Web Controls connecting/disconnecting/reconnecting to one Core.
- [ ] Validate long-running Web Control use with playback continuing correctly across browser
      refreshes and reconnects.

## 8. Network scope

The current release is intended for a trusted home/LAN environment. Authentication, pairing, TLS,
and stricter browser-origin controls can be added later if remote/untrusted-network access becomes a
product goal.

## 9. Current priorities

1. Finish restart/SIGTERM/output-switch/reconnect hardware acceptance.
2. Finish Qobuz real-account acceptance.
3. Validate multiple simultaneous Web Control clients and long-running reconnect behavior.
4. Run the complete install/upgrade/rollback checklist with the 1.0 RC artifact.
5. Publish `1.0.0-rc.1`, collect real-world feedback, then prepare the 1.0 stable release.

## 10. Related documents

```text
docs/atom-development.md            development environment and common checks
docs/build-and-packaging.md         Core/Web build and packaging
docs/build-flavors.md               system/bundled and Diretta build variants
docs/core-deployment.md             systemd, data, migration, upgrade and rollback
docs/hardware-release-checklist.md  ALSA/Diretta/UPnP hardware acceptance
docs/live-provider-acceptance.md    provider real-account acceptance
docs/upnp-output-plan.md            UPnP output design
docs/native.md                      retained Rust/N-API modules
```
