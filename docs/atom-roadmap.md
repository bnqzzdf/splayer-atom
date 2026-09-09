# SPlayer Atom Roadmap

## 1. Product boundary

SPlayer Atom provides exactly two runtime surfaces:

- **Node Core** — the only application/runtime authority;
- **Web Control** — the only supported UI.

The only supported release platform is **Linux x86-64**. Atom does not provide a Desktop edition,
Electron host, Windows/macOS application package, desktop lyric window, tray, global hotkey,
desktop updater, desktop media integration, or desktop-only native addon.

## 2. Core authority baseline

- [x] Core owns database, settings, library, canonical queue, provider sessions, playback policy,
      source resolution, cache, preload/recovery, downloads, statistics, plugins and output choice.
- [x] Web Control uses the Core HTTP/WS contract and does not own playable URL resolution,
      retry/skip, auto-next, Direct staging, or output state.
- [x] Core native runtime is limited to `audio-engine.node` and `streaming-api.node`.
- [x] ALSA, strict Diretta Source Direct and UPnP all execute below the same Core playback
      authority.
- [x] CUE/SACD virtual tracks and CUE track-end boundaries are Core-owned.
- [x] ListenBrainz Scrobble/Now Playing is Core-owned; disabled mode creates no ListenBrainz child,
      DB, HTTP client, retry timer or high-frequency listener.

## 3. Core/Web convergence gate

- [x] Electron runtime/build dependencies and Electron-specific configuration are removed.
- [x] Retained Core sources live under `core/**`.
- [x] Preload/IPC/window/tray/hotkey/updater/desktop-protocol code is removed.
- [x] Desktop/taskbar/dynamic-island lyric windows and related Web branches are removed.
- [x] Desktop-only native crates are removed.
- [x] Windows/macOS packaging and CI jobs are removed.
- [x] Standalone Web Vite is the only UI build.
- [x] Linux x86-64 Core artifacts are the only application packaging path.
- [x] Web Control no longer installs a `window.api`/Host compatibility facade.

## 4. Audio and output acceptance

- [x] Diretta exact PCM Source Direct has real-target bit-perfect evidence through PCM 768 kHz.
- [x] Native DSD Source Direct has real-target logical one-bit verification through DSD512.
- [x] Mixed PCM/Native-DSD Diretta queues have completed long-run transition testing.
- [x] UPnP playback reuses the canonical Core queue/source/cache authority.
- [x] UPnP CUE/SACD extraction/materialization remains isolated from normal and Direct playback.
- [ ] Complete final release-candidate ALSA coverage for common rate/channel/bit-depth combinations.
- [ ] Complete restart/SIGTERM/output-switch/reconnect lifecycle acceptance on the final artifact.
- [ ] Repeat the final hardware checklist from a clean release artifact.

## 5. Provider acceptance

### Netease

- [x] Core provider/session/resolver and Web Control integration exist.
- [ ] Complete real-account favorites/daily/cloud-library acceptance.
- [ ] Complete continuous ALSA/Diretta/UPnP real-account playback acceptance.

### Qobuz

- [x] `native/streaming-api` is the only Qobuz protocol implementation.
- [x] Core session/search/canonical-track/playback resolution is integrated.
- [ ] Complete real-account login/search/queue/playback/logout acceptance.

### TIDAL

- [x] `native/streaming-api` is the only TIDAL auth/request/manifest/DASH implementation.
- [x] Core session/search/JSON-BTS/DASH materialization is integrated.
- [ ] Complete real-account auth/refresh/entitlement/logout acceptance.
- [ ] Validate both JSON/BTS and DASH playback on final outputs.

### ListenBrainz

- [x] Core owns listen-session authority and durable outbox semantics.
- [x] Disabled runtime is zero-resource.
- [x] SQLite/HTTP/retry work runs in the isolated child process when enabled.
- [ ] Complete real-token Now Playing/permanent-listen/401/429/offline/restart acceptance.

## 6. Core artifact and Linux release

- [x] Core runtime range is Node `>=24.18.0 <25`; release reference is `24.18.0`.
- [x] system-runtime and bundled-runtime share one Core JS/native/Web contract.
- [x] Artifact staging validates native addon load, plugin-host IPC, HTTP/WS/Web startup and
      termination.
- [x] Durable `data/`, migration backup, upgrade and rollback procedures are defined.
- [x] Diretta artifacts fail before packaging when required SDK provenance is missing/mismatched.
- [ ] Pin the formal Linux x86-64 builder/sysroot used for releases.
- [ ] Audit the maximum required `GLIBC_x.y` symbol across every ELF in the final artifact.
  - Current development-host audit: both system-runtime and bundled-runtime artifacts require at
    most `GLIBC_2.43`, coming from `native/audio-engine.node`; bundled Node itself requires at most
    `GLIBC_2.28`, while `better-sqlite3` and `streaming-api.node` require at most `GLIBC_2.34`.
  - This development-host result is not a release compatibility baseline; repeat the audit after
    the formal builder/sysroot is pinned.
- [ ] Complete clean artifact, deployment, upgrade, rollback and hardware gates on one release
      candidate.
- [ ] Publish the first Core + Web Control release that passes all gates.

## 7. Web Control acceptance

- [x] Library, playlist, queue, playback, downloads, statistics, cache, providers, settings and
      plugins are exposed through the Core contract.
- [x] Remove all Desktop capability branches/no-op compatibility facades from the Web renderer.
- [ ] Validate multiple simultaneous Web Controls connecting/disconnecting/reconnecting to one Core.
- [ ] Validate long-running Web Control use without creating a second local authority.

## 8. Trusted-LAN security boundary

These are not required for the current single-user trusted-LAN release. Promote them only if the
network/product boundary changes:

- authentication/pairing;
- HTTP/WebSocket authorization;
- CSRF/Origin policy;
- TLS/reverse-proxy deployment guidance.

## 9. Current execution order

1. Pin the Linux release builder and enforce the GLIBC ABI audit.
2. Complete final ALSA/Diretta/UPnP lifecycle and hardware acceptance.
3. Complete real-account Netease/Qobuz/TIDAL/ListenBrainz acceptance.
4. Validate multi-Web-Control long-running behavior.
5. Run clean artifact install/upgrade/rollback acceptance and publish the first formal release.

## 10. Document ownership

```text
AGENTS.md                           durable architecture and implementation rules
docs/atom-roadmap.md                current scope, priorities and acceptance state
docs/atom-development.md            development environment and common gates
docs/build-and-packaging.md         Core/Web build, packaging and Linux ABI rules
docs/build-flavors.md               Core system/bundled and Diretta flavor rules
docs/core-deployment.md             systemd, data, migration, upgrade and rollback
docs/hardware-release-checklist.md  ALSA/Diretta/UPnP hardware acceptance
docs/live-provider-acceptance.md    provider real-account acceptance
docs/upnp-output-plan.md            UPnP source-preserving output design
docs/native.md                      retained Rust/N-API modules
```
