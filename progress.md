# SPlayer Atom — Progress

## 2026-08-29 — Core Protocol closed; durable schema migration safety in progress

- Committed `48e39ec feat: 建立 Core Protocol 与能力契约` and `805f8f2 docs: 记录 Core Protocol 能力契约`. Core `/api/info` now reports shared Protocol v1 plus `library/playback/diretta/netease/qobuz/tidal/remoteOutput` capabilities; Web verifies protocol compatibility before domain HTTP/WS work, and final tar validation checks `runtime.json` against runtime `/api/info`. Diretta capability comes from native `build.json`, so no-SDK artifacts report `false` instead of claiming unsupported hardware capability.
- Current uncommitted work is the next P3 checkpoint: durable data schema migration/backup safety. It reuses existing SQLite `PRAGMA user_version` and settings `__configVersion`; no second persistence framework is introduced.
- SQLite schema baseline is 4 and settings schema baseline is 1. Core now performs a preflight before loading store/database, rejects future unknown schema versions, backs up only installations that actually need migration, uses SQLite `VACUUM INTO` for a WAL-consistent DB snapshot, copies the durable config directory, and runs known SQLite migrations inside one transaction so failure rolls back both schema changes and `user_version`.
- `runtime.json` now records database/config schema versions. Final extracted-artifact smoke verifies a fresh Core produces `settings.json.__configVersion === 1` and SQLite `user_version === 4` after clean shutdown.
- Migration-focused tests pass 6/6. Full regression at the current uncommitted checkpoint passes Node 170/170, Web 52/52, Node/Web typecheck, ESLint, touch audit and the full `build-core-system.ts` final-tar pipeline. Touch budgets are 38 business / 21 runtime-neutral / 13 Core-authority; the added upstream `database/migration.ts` change is explicitly classified as the 21st runtime-neutral persistence seam.
- Before committing this checkpoint, add the planned static schema-metadata regression to `electron/main/services/coreSystemArtifact.test.ts`, rerun proportional/full gates, commit the migration implementation, then update roadmap/progress. Do not reset or discard the current working tree.
- No second Node 24 patch smoke is desired. Supported Node remains `>=24.18.0 <25` with exact reference runtime `24.18.0`. Live Qobuz/TIDAL credentials, Netease/live online acceptance and Diretta hardware gates remain separate external acceptance boundaries.

## 2026-08-29 — Provider product surface and account projection closed

- Froze QQ Music/Kugou out of Atom's formal Desktop/Web search surface while preserving inherited upstream search/collection/lyric/plugin playback compatibility.
- Added one Core-owned token-free `ProviderSessionsSnapshot` for Netease/Qobuz/TIDAL and projected it to both Desktop IPC and Headless WebSocket/HTTP. Netease `user.isLoggedIn` now reads Core authority rather than inferring auth from renderer profile state.
- Added shared Desktop/Web Qobuz/TIDAL account settings using the existing Services schema: Qobuz reuses `auth_login → user/get`; TIDAL reuses `auth_import → /sessions`; tokens stay only in transient input state and are persisted only by Core after validation.
- Restored Qobuz/TIDAL to the formal Web provider/search surface and removed QQ/Kugou from the Headless provider-call allowlist. An isolated Core smoke proved Qobuz/TIDAL `auth_status` succeeds through the Web route while QQ is rejected with `WEB_PROVIDER_UNSUPPORTED`.
- Full gates pass at Node 161/161 and Web 52/52 with Node/Web typecheck, ESLint, Core build audit and Web production build. The explicit upstream touch budgets are now 38 business / 20 runtime-neutral / 13 Core-authority; the sole new business touch is the existing Services settings mount point for the Atom-owned account panel.
- Real Qobuz/TIDAL credentials, entitlement playback, Diretta playback and online auto-next remain external acceptance gates. The next unblocked software task is Core Protocol + capability metadata/compatibility checking.

## 2026-08-29 — Node 24 system-runtime Core artifact closed

- Reworked the roadmap Node strategy after review: Core requires Node but bundled Node is optional. The supported range is `>=24.18.0 <25`, while release/runtime automation uses exact reference Node `24.18.0`; no second Node 24 patch smoke is maintained.
- Committed `f2ed028 build: 增加 Linux Core 原生音频 flavor`: `audio-engine` now has a `core-audio` flavor that builds ALSA-only, excludes PipeWire/PulseAudio and unrelated Desktop native addons, emits release metadata, and can require `DIRETTA_SDK_ROOT` explicitly for SDK-enabled release work.
- Committed `70545b1 build: 固定 Core Node 24 运行契约`: Node Core rejects unsupported runtime versions before loading database/native/plugin state; `/api/info` exposes actual Node, supported range and reference runtime; Core native location is bundle-relative.
- Committed `6e1f457 build: 建立 Core system-runtime staging` and `946ab25 refactor: 分离 Core 数据缓存与日志路径`: Core build has zero Electron runtime refs and only `better-sqlite3` as an external package; staged production data lives under install-root `data/`, cache follows XDG, and Core JS/native logging is stdout/stderr-only while Desktop behavior remains unchanged.
- Committed `221951c build: 建立 Core system-runtime 发行骨架`: formal local orchestrator rebuilds release native + Core JS + Web Control, audits the Core graph, creates deterministic `core-system-linux-x64.tar.gz`, then extracts that tar and starts its launcher on an isolated port. `/api/info`, `/api/session`, `/api/library/count`, Web root and SIGTERM shutdown all pass from the extracted artifact. Repeated staging produced identical SHA256; the current technical tar is about 9.5 MB. This is not yet a formal product release because release identity/CI/protocol metadata/schema migration/hardware gates remain open.
- Current full gates: Node 155/155, Web 52/52, Node/Web typecheck, ESLint, Core build audit and final artifact smoke pass; touch audit is 37 business / 20 runtime-neutral / 12 Core-authority. Core Web packaging no longer mutates tracked Vue declaration files.
- Next unblocked roadmap implementation is the frozen QQ Music/Kugou product-surface cleanup, followed by Core provider-session projection and Qobuz/TIDAL Control UI. Real provider/hardware playback acceptance stays separate and must not be faked by static tests.

## 2026-08-29 — P1 Core-owned playback implementation closed

- Completed and committed the remaining Desktop→Core playback ownership migration through `b4489ac`: Core now owns transport, reload-current, tag-write recovery, output switching, system-media-control transport, native lifecycle and raw playable-source loading; Desktop renderer is a Control projection rather than a second player authority.
- Committed `dfa47a0 refactor: 让插件运行时支持 Node Core`. Existing plugin registry/router/host are reused; Desktop injects Electron utilityProcess/net fetch while Node Core builds and forks `plugin-host.js`. Direct Node host smoke returned `hostReady` and `pong`; Core JS audit remains zero Electron runtime refs.
- Committed `7a6a103 refactor: 让 Core 复用上游插件音源兼容`. Netease retains official→plugin→trial fallback, QQ/Kugou retain only inherited musicUrl compatibility, and Qobuz/TIDAL remain official Atom paths. Shared musicInfo mapping prevents Core/legacy compatibility drift.
- Full gate passes at Node 134/134 and Web 52/52 with Node/Web typecheck, targeted/full ESLint/Prettier, Core multi-entry production build, plugin-host process smoke, zero-Electron artifact audit, `git diff --check`, and touch audit at 37 business / 16 runtime-neutral / 12 Core-authority.
- Updated roadmap section 5 to reflect implementation reality while leaving live-account/hardware acceptance open. The next software implementation target returns to roadmap section 4: fixed bundled Node runtime and Core-only native build flavor/package surface.

## 2026-08-28 — Atom origin published path + Node Core bootstrap proof

- Switched local `origin` to the user-created `https://github.com/bnqzzdf/splayer-atom.git`; retained `splayer=https://github.com/SPlayer-Dev/SPlayer-Next.git` with push disabled and kept `vendor/splayer` on official commit `92026e2c69dd63dd42408ddc5beaf4876d231dc1` while accepted baseline stays fixed at `0f5a2fcbf81904ea4303929f4cb285a57c1d6eee`.
- Continued roadmap section 4 instead of stopping after documentation. Added runtime-neutral environment/fetch/secret/event/playback-presentation seams and moved Desktop-only window/media/tray/Last.fm presentation behind a Desktop adapter. Database/settings/song-cache/playback-session/provider code remains shared rather than duplicated.
- Added independent `electron/main/core-node/index.ts` and `scripts/atom/vite.core.config.ts`. Node/Web typecheck, ESLint, Node 75/75, Web 52/52 and production Core build pass; built Core JS now contains zero Electron imports.
- Ran a real ordinary-Node process smoke with isolated user data. Core successfully loaded the existing native audio engine and started Hono/WS; `/api/info`, `/api/session`, and `/api/library/count` returned valid responses. `/api/info` now uses runtime metadata rather than the old hard-coded SPlayer name.
- Split upstream touch reporting into the existing 37 business-code budget and a separate explicit 13-file runtime-neutral seam budget. Both budgets currently pass; runtime seam growth remains gated rather than hidden by increasing the business count.
- Development-machine Node/pnpm still exhibits the previously recorded intermittent SIGSEGV while launching Prettier; direct TypeScript/Core build/smoke commands continue to work. This remains a reproducible-build/release-environment issue for roadmap section 14, not a product decision blocker.
- No user decision is currently required to continue roadmap implementation. The next implementation target is to finish the Node Core/Desktop boundary and then move canonical Track source resolution and recovery into the existing authoritative playback session.

## 2026-08-28 — Roadmap P0 upstream sync started

- Re-read root `AGENTS.md`, `CLAUDE.md`, persistent planning files, and the full `docs/atom-roadmap.md`; roadmap section 18 now governs execution order over the older Phase 16 handoff state.
- Session catchup found two unsynced tool-only messages but `git diff --stat` was empty before this session's edits, so there was no recovered code delta to preserve.
- Confirmed current Git topology is still the bootstrap model: only `origin` exists, it points directly to `SPlayer-Dev/SPlayer-Next`, and local `dev` tracks `origin/dev` while sitting 24 commits ahead.
- Confirmed the accepted upstream baseline is official commit `0f5a2fcbf81904ea4303929f4cb285a57c1d6eee`; current official `splayer/dev` has since advanced, proving the touch audit must stop depending on a moving remote-tracking ref.
- Starting the repository-level sync implementation now: fixed baseline record, topology/status tooling, stable touch audit, upstream integration CI/report, and maintenance documentation. Node Core work remains blocked behind completion of this P0 foundation.

## 2026-08-28 — Headless local Web phase completed

- Resumed from `docs/handoff-2026-08-28.md`, fixed the Atom-owned Hono Context type blocker, and restored Node/Web typecheck.
- Consolidated browser differences into the Atom-owned `src/web/api.ts` facade instead of scattering `isWebRemote()` branches through upstream SPlayer components. Library, navigation, layout, settings, menu and lyric callers were restored to upstream behavior where the facade can satisfy the contract safely.
- Preserved the main process as the sole playback-session/queue authority. Renderer queue helpers now forward clear/server-removal commands and apply returned main snapshots; batch insertion keeps the upstream synchronous caller shape without locally mutating queue state.
- Added a real Headless server-track removal route so the Web facade no longer returns fake success for `removeSessionServerTracks`.
- Reduced upstream business-code touches from 51 to 37. The six touches above the former 31 baseline are retained only for Headless lifecycle, Native DSD scan discovery, Web bootstrap, main-session queue projection, its authority tests and removal of duplicate renderer session persistence. The audit now enforces 37/37.
- Full gates pass: typecheck, ESLint, Node 72/72, Web 48/48, no-SDK native 105/105, SDK 149 native 100/100, SDK release native build, production Electron/Vite build and `git diff --check`.
- Rebuilt and restarted the root production Headless service. Formal Chrome UI smoke passed on the new build: 379 tracks, 52 artists, 27 albums, 33 folder nodes, Native DSD256 and PCM FLAC playback progress, pause/resume, seek, next/prev, repeat/shuffle, queue move/remove/rebuild, scan-dir prompt add/remove and temporary local-playlist CRUD. Test scan dir and playlist were removed afterward.
- The complete local-music Web phase is closed. Next product work can move to settings/online-provider UI and user-driven account validation without changing the single-runtime/single-authority architecture.

## 2026-08-27 — Local safety checkpoint and recovery investigation resumed

- User added three more proven local connection oracles beside tinyLMS: tinylms-next, slim2Diretta and DirettaRendererUPnP. Starting a read-only four-way SDK connection/lifecycle matrix; no Target access or implementation change occurs until the shared successful contract is identified.
- Resumed the user-requested root-cause fix without touching the Target. Full same-model comparison shows Atom and tinyLMS both derive `DIRETTA::Sync`; Atom's format/transport parameters had already produced the first successful real paused load, while `55fa9eb` later introduced the only connection-completion regression: a fixed 10-second `is_online()` deadline replacing the SDK's full wait. Existing tests prove boundedness but not a sufficient negotiation window. Preparing a one-constant 60-second bounded-wait correction plus regression assertion; no tinyLMS tuning, format widening or new architecture is being copied.
- Applied the one-constant 60-second bounded negotiation candidate and locked it with the existing bridge static regression. Focused no-SDK and SDK-enabled tests both pass. The first SDK release addon rebuild then hit an internal Rust 1.98 LLVM/LTO `GlobalOptPass` SIGSEGV rather than a source diagnostic; retrying with rustc's recommended larger `RUST_MIN_STACK`, not repeating the identical failed invocation.
- Retried the SDK-enabled release build with `RUST_MIN_STACK=16777216`; LTO completed and all four native release modules built successfully. The compiler crash is resolved as a toolchain-stack event rather than a source failure.
- Completed native validation for the 60-second candidate: no-SDK 101/101, SDK-enabled 96/96, release addon load/exports, no TEXTREL and no dynamic libstdc++. Hardware is still untouched. The next action is exactly one root-owned test after fresh user confirmation that DX5 II is free; no automatic retry or Target reset follows either result.
- After the user freshly confirmed DX5 II was free, ran exactly one root-owned 60-second candidate test. Discovery/selection passed at about 0.385 seconds, but connection never came online and timed out at about 60.76 seconds; Node exited naturally before the 80-second outer bound. No retry or Target action followed. Reverted the ineffective timeout code/test change and retained only the investigation record.
- User reported long, successful tinyLMS playback against the same Target. Reclassified the blocker as an Atom Source connection defect, stopped Target-side work/hardware retries, and began an offline semantic comparison before proposing any code change.
- Logged into the Target host read-only. It is a Buildroot/PREEMPT_RT appliance using BusyBox init, with `/dpdk/diretta.sh` launching an active `/opt/diretta_target/diretta_app_target`. Diretta ports are listening, `eth0` and the link-local selector address match discovery, and DX5 II is attached over USB. Kernel history shows one old Target-app segfault after USB cycling plus a more recent DDS unregister/register sequence. No restart has been performed yet; launcher/settings/syslog inspection comes first.
- Inspected the Target launcher and current process. The app is supervised in an infinite three-second restart loop, its current instance started at 11:26:22, and stdout/stderr are discarded. Target/DDS and PCM format settings are enabled. Since an app/DDS restart already preceded the latest failed Source check, the next evidence-based recovery is the user-authorized full Target reboot, followed by readiness verification and exactly one bounded Source check.
- Rebooted `192.168.1.44` under the user's authorization. The host went offline and returned normally. Verified a clean boot, attached DX5 II USB device, linked Ethernet, freshly loaded/registered DDS module, active Target app and expected UDP listeners. Proceeding with one bounded post-reboot Source check only.
- Ran the single bounded post-reboot Source check. It reproduced the same ~10.76-second connection-completion timeout and exited naturally. Read-only Target inspection afterward found no crash, DDS unregister or listener loss. Stopped hardware attempts and moved to offline Source SDK sequence/address/configuration comparison.
- Compared Atom's Source sequence with SDK 149 `SinHost` and retained tinyLMS. Atom matches the official pull-mode parameters through `connect(0)`; the material difference is the recovery patch's deadline polling of `is_online()` in place of the official/legacy `connectWait()`. Next step is inspecting the SDK implementation/symbol behavior and designing a bounded way to retain required `connectWait()` semantics without reintroducing an unbounded application hang.
- Disassembly shows `connectWait()` mainly waits for worker-updated state, so it is now secondary. Corrected an initial buffer-ownership suspicion after confirming each Rust `next_block()` releases the prior slot. Further SDK disassembly proves `getNewStream()` is gated by `playFlg`, excluding pre-play source drain as the connection-timeout cause. Analysis is now limited to the actual negotiation parameters; no further hardware retry is being made.
- User confirmed the missing operational prerequisite: Linux Diretta Host connection requires root. Verified the failed Atom harness ran as `uid=1000` with no effective/ambient or file capabilities, whereas working Diretta deployments run as root or receive raw-network capabilities. Recorded root + exclusive Target ownership as mandatory preconditions; no connection-code change or hardware retry was made.
- Ran the single newly authorized root-owned check after treating the user's test instruction as confirmation that DX5 II was available. The fresh process logged `uid=0`/`gid=0`, uniquely discovered and selected DX5 II in about 0.38 seconds, then reproduced the same explicit Direct connection timeout at about 10.76 seconds while loading a silent 44.1 kHz / 16-bit / stereo FLAC. It exited naturally with status 1; the 45-second outer bound did not fire. Root is necessary but not sufficient, so hardware retries and Target recovery stop while Atom/tinyLMS negotiation differences are analyzed offline.
- The user identified the Target host as `192.168.1.44` and explicitly authorized root SSH diagnosis plus reboot as needed. Starting with read-only Target inspection; no reboot will occur until service/process/log/network evidence is collected.
- Ran the single authorized post-release check in a fresh Node process with a 35-second external bound. DX5 II discovery/selection passed at about 0.38 seconds; silent PCM `load(false)` returned the bridge's explicit connection timeout at about 10.76 seconds. Node exited naturally with status 1, no outer kill was needed, and no second hardware attempt was made. Hardware work is paused for user discussion.
- The user confirmed DX5 II was released from the other program and authorized exactly one bounded fresh-process connection/load/stop/natural-exit check, with any failure stopping the hardware sequence for discussion rather than triggering an automatic retry.
- User clarified that DX5 II was most likely occupied by another program during the failed connection attempts. The earlier stale/orphaned-session interpretation was not proven. Future ambiguous hardware failures stop immediately for user confirmation of exclusive Target availability before any retry, recovery conclusion or reset request.
- Created the two ownership-oriented safety commits: `e809887` for Atom-owned/downstream implementation and `c3cf146` for SPlayer integration seams. The working tree was clean immediately afterward.
- Re-ran the full committed baseline successfully: Node 71/71, Web 54/54, typecheck, ESLint, production build, no-SDK audio-engine 100/100, SDK 149 audio-engine 95/95, SDK-enabled release build/addon load, required Direct exports, no TEXTREL, no dynamic libstdc++, 31-business + 2-generated touch audit, and committed diff whitespace checks.
- Began the recovery investigation without issuing another Direct load. The first code inspection confirms that open/connect phases are not individually observable and close can wait indefinitely in `disconnectWait()`; the next step is to inspect SDK-supported timing/cancellation behavior before adding narrow diagnostics.
- Built the SDK debug addon and used GDB breakpoints for one controlled silent-fixture attempt. DX5 II remained discoverable; every open phase through `connect(0)` returned, then `connectWait()` returned false and Node exited naturally. No repeated blind load loop was run.
- Added shared RAII cleanup for partially opened and active bridge connections plus a static regression guard. Focused no-SDK and SDK-enabled tests pass.
- The first post-cleanup recovery attempt still exceeded its 30-second external bound inside connection completion and was terminated with status 124. This rules out cleanup-only recovery and justifies replacing unbounded `connectWait()` with a deadline over the SDK's atomic connection state.
- Replaced unbounded `connectWait()` with a 10-second poll of SDK atomic online state. Focused no-SDK/SDK tests pass; two hardware processes returned explicit failures in ~10.75 seconds and exited naturally rather than hanging. Because external Target occupancy was unknown, these attempts do not establish a stale Target session or cleanup failure.
- Added a bounded disconnect-state drain before SDK `close()` and tested one cleanup process followed by one fresh reconnect. Both remained bounded and exited naturally, but connection completion still failed. Stopped further automatic Direct loads pending user confirmation that DX5 II is exclusively available.
- Audited Electron shutdown and found the native player was not explicitly stopped on `before-quit`. The existing `resetPlayer()` hook is already imported by the player IPC module and can close Direct playback without expanding the upstream touch inventory.
- Added explicit native-player reset to the existing Electron `before-quit` path and an Atom-owned static shutdown guard. The upstream touch inventory remains 31 business files + 2 generated declarations.
- Final recovery-patch validation is green: Node 72/72, Web 54/54, typecheck, ESLint, production build, no-SDK audio-engine 101/101, SDK 149 audio-engine 96/96, SDK-enabled release build/addon load, Direct exports, no TEXTREL, no dynamic libstdc++, touch audit and `git diff --check`.

## 2026-08-27 — First automated real-Diretta pass and local-agent transfer

- Local-agent safety checkpoint confirmed the handoff inventory exactly: 31 upstream business files, 2 generated declarations, 3 downstream metadata files and 47 Atom-owned additions. The repository-local Git author identity was restored from the existing `tinylms-next` configuration before creating the ownership-oriented commits.
- Kept Qobuz/TIDAL live-account and manual DAC/front-panel actions deferred, then used the SDK-enabled release addon directly from Node for acceptance requiring no user interaction.
- Automatically discovered the real **DX5 II** Target. Three repeated scans returned the same stable selector; CPAL + Diretta enumeration had no ID collision.
- Verified real-selector Direct guards: incompatible volume/fade/normalization/EQ/preamp/speed/pitch changes are rejected while Diretta is selected, and incompatible ordinary-mode state blocks Diretta entry before selection changes.
- Used a silent 44.1 kHz/16-bit/stereo FLAC fixture for low-risk hardware validation. First Direct paused load and exact format negotiation succeeded; exact seek to 1.5 s returned ~1.499999 s.
- Continuous playback transport is not yet accepted: the first harness did not conclusively observe position advance, and the Node process remained alive after `stop()` until timeout termination.
- After that abnormal client termination, host processes were clean and DX5 II remained discoverable, but fresh processes repeatedly hung in the next Direct `load()`/stream-creation path. This establishes the current acceptance blocker as Diretta session teardown/recovery rather than discovery or renderer logic.
- Re-ran all automatic gates after the hardware attempts: Node 71/71, Web 54/54, typecheck, ESLint, production build, no-SDK audio-engine 100/100, SDK 149 audio-engine 95/95, release native build/addon load, ELF constraints, 31-business + 2-generated touch audit and `git diff --check` all remain green.
- The remote DevSpace Git surface cannot stage/commit, so HEAD is still the upstream baseline and the working tree is intentionally uncommitted. Added `docs/handoff-2026-08-27.md` with exact two-commit ownership split and the next non-interactive recovery/PCM/gapless/DSD/long-run validation order for a local agent.

## 2026-08-26 — Direct-mode UI transparency complete

- Continued exactly from the post-online-Direct stop point; no Source Direct, lifecycle, discovery or Qobuz/TIDAL input architecture was redone.
- Added Atom-owned derived Direct UI state/preflight only; it reads existing settings/status and mirrors native entry requirements without introducing a new store or persisted Direct domain.
- Added a reusable Direct notice on existing player settings / EQ / speed surfaces. Software volume, EQ/preamp, speed/pitch, fade and normalization controls are visibly locked when Diretta is selected while ordinary-output values remain preserved.
- Added renderer preflight before Diretta switching so incompatible volume/normalization/EQ/speed/pitch state is rejected before remote materialization, stop or device change. Startup also refuses an incompatible persisted Direct selection without silently altering sample-processing settings.
- Added core guards so hotkeys/other renderer calls cannot bypass the Direct UI lock; native `[Direct]` refusal remains authoritative below the renderer.
- Added `directUi.test.ts` architecture guards. Node tests now pass 71/71 and Web remains 54/54; TypeScript/Vue typecheck and ESLint pass.
- Production Electron/Vite build passes. Native regression remains green with no Rust changes: no-SDK audio-engine 100/100 and SDK 149 audio-engine 95/95.
- SDK-enabled release native build and actual addon load pass; ELF still has no TEXTREL and no dynamic libstdc++. Full `git diff --check` passes.
- Re-audited maintenance pressure before raising the touch budget: exactly six new upstream UI/i18n files are required, moving the explicit business-code budget from 25 to 31. Direct derivation/notice/tests remain Atom-owned; generated `native/audio-engine/index.d.ts` and Vue auto-import `components.d.ts` are reported separately.
- No real Target discovery/playback, DAC verification, Qobuz token request or TIDAL entitlement request was performed. All pre-hardware Diretta work is now automated-proof complete; the next stop is the final consolidated real-machine acceptance pass.

## 2026-08-26 — Qobuz/TIDAL strict online Direct input

- Added Atom-owned `electron/main/atom/directInput.ts` + tests. It turns a resolved HTTP(S) audio response into a process-lifetime local seekable file without decode/transcode/sample processing, reuses identical completed materializations, prunes superseded files, discards only managed failed inputs, and cleans the temp root on app exit.
- Added one thin player IPC/preload/shared API method for Direct materialization; no provider-specific player, second cache, second queue/store, OutputBackend, or Zone domain was added.
- Added `prepareDirectTrackSource()` to the existing `audioSource` seam. It is provider-agnostic at the materializer layer but deliberately enabled only for Qobuz/TIDAL + `diretta:`. Existing song cache is reused when enabled; otherwise the temporary exact-byte materializer provides Direct correctness without changing user cache settings. TIDAL DASH `localPath` passes through unchanged.
- `loadTrackSourceWithFallback()` now prepares online Qobuz/TIDAL inputs before native Direct load. Materialization failure reports `NETWORK_ERROR`; Direct load/format failure does not trigger provider fallback and can never enter the normal `f32` player.
- Added device-switch handling for a remote Qobuz/TIDAL track already playing on a normal output: prepare local Direct input first, stop only after preparation, switch the existing output selector, Direct-load the local source, restore position/play state, and restore the old normal source if the device switch itself fails.
- Extended next-track preload so online Qobuz/TIDAL Direct sources are prepared locally before native `stageDirectNext()`. Gapless boundary commit now prunes the old temp input without normal reload/stop.
- Added fixture/static proof for exact response-byte preservation, temp-file reuse/prune/discard ownership, no remote native load in Direct, no misleading provider fallback after materialization failure, online Direct staging order, remote→Diretta switching order, cached FLAC content probing with a generic extension, and TIDAL fragmented-MP4/FLAC Direct demux.
- Final automated validation is green: Node 67/67, Web 54/54, typecheck, ESLint, production build, no-SDK audio-engine 100/100, SDK-enabled audio-engine 95/95, SDK-enabled release native build, actual addon load, no TEXTREL, no dynamic libstdc++, downstream-touch 25 business + 1 generated, and `git diff --check`.
- Real Qobuz/TIDAL auth/entitlement requests and live Diretta Target/DAC playback remain intentionally deferred. That session's next stop was Direct-mode UI transparency; it is now complete, and the current stop is final consolidated real-machine acceptance.

## 2026-08-26 — Async Diretta Target discovery resumed

- Re-read root instructions, persistent planning files, and `docs/handoff-2026-08-26.md`; resumed only the async Target discovery seam and kept all account/DAC/Target acceptance deferred.
- Confirmed the working tree contains the prior uncommitted Atom work and has not been reset or committed.
- Confirmed `diretta::scan_devices()` already has real-SDK and no-SDK implementations with stable `diretta:` selectors.
- Implemented the narrow discovery plumbing: async `AudioPlayer.scanDirettaDevices()` isolates SDK discovery with `spawn_blocking`, main/preload/shared API expose the method, and `refreshDevices()` merges discovered targets into the existing CPAL `status.outputDevices` list. `DeviceSelector`, settings persistence, and `switchDevice()` remain unchanged.
- No-SDK native validation is green after adding the missing `diretta::scan_devices` re-export: `cargo test -p audio-engine` passes 98/98 and `pnpm build:native --dev` succeeds. NAPI-RS regenerated `native/audio-engine/index.d.ts` with `scanDirettaDevices(): Promise<Array<JsAudioDevice>>`; targeted `git diff --check` passes.
- Whole-app validation is green after discovery plumbing: `pnpm typecheck`, Node 59/59, Web 54/54, ESLint, and `SKIP_NATIVE_BUILD=true pnpm build` all pass.
- SDK 149 validation is also green without performing a live scan: SDK-enabled `cargo test -p audio-engine` passes 93/93 (the no-SDK/fake-only cfg tests are absent in this build), release `pnpm build:native`, Node addon load/export check, no-TEXTREL/no-dynamic-libstdc++ ELF checks, downstream-touch budget (25 business + 1 generated declaration), and full `git diff --check` all pass. Real Target discovery remains deferred to final hardware acceptance.

## 2026-08-26 — Direct Lifecycle / gapless closure and session handoff

- Completed the Direct Lifecycle Gate: Diretta Direct load/play/pause/stop/seek/status/error now lives under the existing SPlayer `InnerPlayer` state owner while branching before normal `Shared`/`Resampler<f32>`/DSP/normal `PlaybackHandle` construction. Architecture tests guard against re-entry into the normal pipeline.
- Enforced the approved product behavior for Direct mode: software volume below unity, ReplayGain/Normalization, EQ/preamp, fade, tempo and pitch are explicitly rejected with `[Direct]` errors; Direct never silently exits or applies processing.
- Direct PCM/DSD seek now reuses the same Diretta connection, callback context and ring and is mechanically proven bit/sample exact.
- Added same-wire-format staged source handoff and queue-aware renderer generation commit. Native tests prove sample-contiguous PCM and bit-contiguous DSD track boundaries with no reconnect/silence, while renderer commits media/queue state without calling normal `load()`.
- Gapless staging is intentionally limited to compatible local/cache seekable sources and is disabled for repeat-one, wait-for-track-end auto-close and CUE semantics. Local metadata/embedded/external lyrics are carried through a read-only metadata probe that does not create the normal player resamplers.
- Added Atom-owned `src/core/player/directGapless.test.ts` architecture guards for renderer boundary handling.
- Latest validation is green: Node 59/59, Web 54/54, audio-engine 98/98, TypeScript/Vue typecheck, ESLint, production Electron/Vite build, SDK 149 compile/link, SDK-enabled release `audio-engine.node` build and actual Node load, `git diff --check`, and downstream-touch check.
- Re-audited downstream maintenance pressure: the frozen inventory is now 25 upstream business-code touches plus one generated NAPI declaration (`native/audio-engine/index.d.ts`). The check script still lists every path; do not raise this budget casually.
- Began the next small phase, async Diretta Target discovery. `diretta::scan_devices()` and stable `diretta:<target-id>` selectors already exist, but the NAPI/IPC/preload/`refreshDevices()` plumbing is not yet implemented. Existing `DeviceSelector`, `settings.player.outputDevice`, and `switchDevice()` must remain the only device state/UI path.
- Added `docs/handoff-2026-08-26.md` with repository state, completed architecture, validation evidence, truth boundaries, exact current stop point, next implementation flow and final real-machine acceptance plan for the next conversation.
- Handoff consistency check after documentation updates passes: `cargo test -p audio-engine` 98/98, `pnpm typecheck`, `git diff --check`, and the 25-business-touch + 1-generated-declaration inventory all pass. Remaining native test-only dead-code warnings are staging/helper warnings, not failures.

## 2026-08-26 — APE + Native DSD HiFi Gate

- Added real Monkey's Audio evidence without introducing an APE-specific decoder: FFmpeg APE16 decodes as `S16P`, then reuses the established integer-only `BitPerfectRepack` path. The embedded 104-byte real APE fixture decodes to the expected exact PCM samples.
- Confirmed FFmpeg APE decoder supports `u8p/s16p/s32p`. Strict Direct currently accepts high-fidelity `S16P/S32P`; rare `u8p` remains explicit unsupported because unsigned→signed PCM8 would be reversible but not bit-identical. APE24/32 use the same proven S32P repack implementation, although this machine has no APE encoder for a codec-specific 24/32 fixture.
- Added Atom-owned `direct_dsd.rs`: a streaming DSF/DFF native parser with fixed eight-slot buffers. It never invokes FFmpeg PCM decoding, resampling, float conversion, DoP, software volume, or DSP.
- DSF preserves source LSB-first bits; DFF preserves source MSB-first bits. Both perform only the lossless memory-layout repack required by Diretta `DSD_SIZ_32` (L4R4). No bit reversal or compatibility fallback is performed.
- Added strict DSD C ABI integration through the existing `DIRETTA::Sync::getNewStream` pull callback. Exact negotiation is `FMT_DSD1 | FMT_DSD_SIZ_32 | FMT_DSD_BIG | source LSB/MSB`; unsupported Target combinations fail instead of converting.
- SDK 149 local format probes confirm both DSD64 LSB+BIG and MSB+BIG configurations are valid 1-bit, 2-channel, 2.8224 MHz formats. Real TagLib `empty10ms.dsf/.dff` fixtures both stream-drain exactly 7056 native bytes, matching 10 ms × 2.8224 MHz × 2 channels / 8.
- Native automated validation now passes 81/81 without SDK; SDK-enabled full tests pass as well. Default `pnpm build:native --dev` remains clean, while SDK-enabled release `audio-engine.node` builds and loads successfully with no TEXTREL and no dynamic libstdc++ dependency.
- Whole-app regression remains green: Node 57/57, Web 54/54, TypeScript/Vue typecheck, ESLint, production Electron/Vite build, targeted rustfmt, `git diff --check`, and the 13-file upstream-touch budget all pass.
- This HiFi Gate stops before SPlayer playback-state/seek wiring, same-format connection reuse/gapless, DeviceSelector/UI, and real Diretta hardware acceptance.

## 2026-08-26 — PCM Source Direct HiFi Gate expanded for ALAC/WavPack

- Replaced the earlier planar-PCM strict rejection with a formal `BitPerfectRepack` path: packed S16/S32 remains zero-copy, while ALAC/WavPack S16P/S32P performs one integer-only planar→interleaved repack in the non-RT decode producer and then stays zero-copy through the Diretta SDK callback.
- Added bit-exact fixtures for ALAC16, ALAC24, WavPack16, WavPack24, and WavPack32. The tests compare known integer sample patterns directly; no approximate/hash-only acceptance is used.
- Direct PCM tests now cover WAV16/24/32, FLAC24, ALAC/WavPack planar repack, 32-bit full-range identity, retained FFmpeg frame lifetime, callback pointer identity, strict underrun behavior, float rejection, and no-float/no-DSP architecture guards. Full Linux `cargo test -p audio-engine` passes 73/73.
- Replaced the `SyncBuffer::setStream` prototype with `DIRETTA::Sync::getNewStream` pull mode. The real-time callback borrows stable pointer+size only; automated guards reject memcpy/setStream/resize/mutex/discovery/format work inside the callback.
- The real DirettaHostSDK 149 Linux static archives are non-PIC. Final NAPI/cdylib linking initially failed even though executable/test links passed; validated and adopted static libstdc++ + `-Wl,-Bsymbolic`, after which SDK-enabled debug and release `audio-engine.node` build and Node load succeed with no TEXTREL and no dynamic libstdc++ dependency.
- Default no-SDK `pnpm build:native --dev` remains warning-free. SDK-enabled release warnings are limited to external SDK header diagnostics.
- Removed premature Diretta scan/support NAPI and TypeScript declarations; DeviceSelector/UI remains deferred until the Source Direct proof is approved. The justified upstream business-code touch budget is now 13: 8 provider touches + 1 Headless mount + 4 native build/module seams.
- Whole-app validation remains green: TypeScript/Vue typecheck, Node 57/57, Web 54/54, ESLint, production Electron/Vite build, `git diff --check`, and upstream-touch check all pass.
- PCM HiFi Gate is not yet complete: APE fixture behavior, native DSD, integration with SPlayer playback state/seek, same-format connection reuse/gapless, and real Diretta hardware acceptance remain deliberately pending.

## 2026-08-26 — Diretta Source Direct architecture correction

- Reclassified the current `SyncBuffer::setStream` + Rust `f32 -> i32` feeder as compile/link/lifecycle prototype only, not a production Diretta path.
- Established mandatory Source Direct invariants in root `AGENTS.md`: no resampling, remixing, EQ, normalization, software volume, fade, tempo/pitch, re-encoding, or silent processed fallback; native DSD must remain native DSD.
- Confirmed current SPlayer normal playback always passes decoded audio through an `f32` player resampler, so Diretta must branch before that path for strict direct playback while still reusing SPlayer UI, queue, source resolution, metadata, seek/control state, and external APIs.
- Confirmed `ffmpeg_audio::AudioFrame::raw_data<T>()` provides zero-copy access to decoder AVFrame samples for integer/float formats. The next architecture proof is retained AVFrame ownership across asynchronous Diretta callbacks without copying sample payloads, plus a separate native-DSD path.
- Audited `/home/bnqzzdf/code/tinyLMS`: its Diretta callback borrowing concepts remain useful, but its generic PCM path normalizes to S32 through Swr/SoXR and may up/downsample, so it is not the fidelity reference for Atom Source Direct.
- No further Diretta UI/device plumbing should be implemented until these audio invariants are mechanically testable.

## 2026-08-26 — Phase 13 resumed

- Added English and Chinese downstream attribution to the upstream README files while leaving the upstream `LICENSE` untouched.
- Phase 11 baseline is now complete: current upstream JS/TS/Vue/native baselines are green on Linux, architecture discovery is complete, and downstream attribution is explicit.
- Phase 13 implementation target remains the smallest Qobuz vertical slice: Qobuz service/auth/search/signed stream URL integrated directly into current SPlayer `Platform`, Search, `Track`, queue, cache, and `audioSource` paths.
- Current Qobuz API terms were rechecked: a valid Qobuz-issued Application ID/secret is required and those identifiers must not be shared, so Atom will not bundle or scrape a shared application secret.
- Began the Qobuz production slice without adding a provider framework: `electron/main/apis/qobuz/config.ts` reads only explicit Qobuz-issued app credentials, while `auth.ts` persists a validated user token with Electron `safeStorage` and supports environment-provided auth for development/deployment.
- Added a pure Qobuz v0.2 signature function and a concrete signed request helper. The request layer only adds app credentials, optional user token, timestamp/signature, and a 15s timeout; no retry/cache/provider abstraction was introduced.
- Added the minimal Qobuz action entry point (`auth_login`, `auth_status`, `auth_logout`, `catalog_search`, `track_getFileUrl`) plus focused signature tests using the retained `track/getFileUrl` signing rule.
- Connected the renderer side with a thin Qobuz proxy, a Qobuz-search-to-canonical-`Track` formatter, and songs-only catalog search. No Atom media model or provider registry was introduced.
- Extended current SPlayer platform/search/audio-source seams directly: Qobuz is now a `Platform`, appears in Search with songs-only capability, uses a quality-aware existing song-cache key, and resolves playback through signed `track/getFileUrl` before handing the URL to the existing SPlayer cache/player pipeline.
- Validation is green after the Qobuz patch: formatter tests 2/2, Qobuz signature tests 2/2, full Node tests 46/46, Web tests 54/54, TypeScript/Vue typecheck, ESLint, `git diff --check`, and production Electron/Vite build with unchanged native build skipped.
- The first Qobuz implementation touches 8 upstream-owned business-code files, meeting the mature downstream touch target. No Qobuz credentials are present in the current DevSpace environment, so live API/playback acceptance remains pending local credentials rather than code changes.
- Added `scripts/atom/check-upstream-touch.mjs`; it compares the working tree against `origin/dev`, separately reports upstream business-code edits, downstream metadata edits, and Atom-owned additions, and fails when the business-code touch budget exceeds 8. The script, ESLint, and `git diff --check` all pass.
- Updated `docs/atom-development.md` with the now-green Linux native baseline, the correct Linux native test command, local Qobuz environment-variable setup, and the remaining live acceptance gate.

## 2026-08-25 — Session handoff

- Stopped before Qobuz production code changes; current upstream application source remains functionally unmodified apart from mandatory Atom project rules/planning docs.
- Recorded the next-session sequence in `task_plan.md`: install Rust/native Linux dependencies, verify the upstream native baseline, then implement the smallest Qobuz search → signed stream URL → existing SPlayer playback slice.
- Added `docs/atom-development.md` with concise Debian/Ubuntu dependencies, rustup installation, native baseline commands, Electron `better-sqlite3` rebuild command, and Qobuz scope guardrails.
- Preserve the current architectural conclusion: NetEase/QQ Music/Kugou are upstream-owned; Atom currently owns only Qobuz/Tidal additions and Diretta output.

## 2026-08-26 — Phase 15 Headless/Core compatibility

- Deferred all credential/account/device acceptance to the final real-machine acceptance pass; mainline work proceeds with automated validation only.
- Classified all 69 retained HTTP contracts and added a machine-readable report; the first compatibility slice is intentionally narrower after security review.
- Added Atom-owned `electron/main/atom/compat/routes.ts` and mounted it once into the existing SPlayer external API server. The first slice exposes read-only local library/search/random state, scan status/start/cancel over already-configured directories, `/lyrics/current`, and `/output/scan` by directly reusing current SPlayer services.
- Arbitrary `/load`, library-root/scan-dir mutation, queue sync, plugin/settings administration, Zones, mDNS, and PCM streaming remain intentionally unimplemented until their trust/state boundaries are proven.
- Phase 15 automated regression is green: Node 57/57, Web 54/54, typecheck, lint, `git diff --check`, production build, legacy-contract report, and upstream-touch check all pass. The justified full-product upstream-touch budget is now 9: eight provider integration files plus one stable external-server mount.
- Phase 15 is complete. Current WebSocket/MCP plus the safe compatibility router provide Core remote-control/library capability without a second Headless domain; exact legacy filesystem/load/queue/PCM/discovery surfaces remain explicit deferred contracts, not hidden TODO architecture.

## 2026-08-26 — Tidal implementation started

- Qobuz live token/search/playback acceptance is deferred because no user-owned Qobuz auth token is currently available; implementation remains green and does not block the mainline.
- Tidal Architecture Discovery confirms current 2026 clients still use OAuth access/refresh tokens, `/search`, and `tracks/{id}/playbackinfopostpaywall`; Hi-Res may arrive as DASH.
- Added Atom-owned Tidal config/auth/request/manifest/main modules. First slice deliberately avoids embedding retained tinyLMS shared client credentials and supports secure imported OAuth tokens with optional refresh.
- DASH is recognized explicitly; direct JSON/BTS URLs are playable immediately and quality fallback may reach LOSSLESS direct URLs. Full DASH playback remains a separate real seam rather than being hidden behind a false success.
- Tidal static integration is green: focused Tidal tests 5/5, full Node tests 54/54, Web 54/54, typecheck, lint, production build, `git diff --check`, and upstream-touch budget all pass; upstream business-code touches remain exactly 8.
- DASH audit found the current bundled FFmpeg has DASH demuxer and FFmpeg HTTP/HTTPS protocols disabled, while MOV/MP4 demuxing and FLAC decoding are enabled.
- Implemented an Atom-owned strict TIDAL DASH parser and process-lifetime materializer: current Number-based SegmentTemplate/SegmentTimeline manifests become initialization + ordered media URLs, then one temporary fragmented MP4. Unknown Time-based/unbounded variants fail explicitly.
- Integrated materialized DASH paths into existing `audioSource` as non-cacheable official local sources; direct JSON/BTS URLs continue through the normal SPlayer song-cache/player path.
- Local decoder proof succeeded: a generated fragmented-MP4/FLAC fixture loaded directly through the built SPlayer `audio-engine.node` with the correct 1-second duration and paused state. Runtime TIDAL DASH therefore does not require system ffmpeg or Rust decoder changes.
- Tidal/Qobuz live-account acceptance remains deferred because the current environment has no user OAuth tokens/client configuration. Phase 14 implementation is complete enough to unblock the mainline; Phase 15 Headless/Core compatibility convergence is now active.

## 2026-08-25 — Current upstream baseline imported

- User checked out current SPlayer-Next `dev` into `/home/bnqzzdf/code/splayer-atom`.
- Verified HEAD `0f5a2fc` and upstream GitHub remote.
- Read upstream `AGENTS.md` and `CLAUDE.md` before making architecture changes.
- Re-added the mandatory Atom minimalism/downstream rules into root `AGENTS.md`, preserving upstream engineering guidance below them.
- Restored persistent `task_plan.md`, `findings.md`, and `progress.md` into the product tree.
- Architecture Discovery is now the active work: inspect current provider/plugin/media/playback/external-control/native-output APIs before moving any bootstrap contracts or recovered tinyLMS code.
- Installed the locked upstream dependency graph with lifecycle scripts deferred after the initial install exceeded the DevSpace time limit.
- Unmodified upstream `pnpm typecheck` passes.
- Unmodified upstream `pnpm test` passes: 42/42 Node tests and 54/54 Web tests (96 total).
- Unmodified Electron/Vite production build passes with `SKIP_NATIVE_BUILD=true`; main, preload, renderer, and auxiliary lyric windows all build successfully.
- Architecture Discovery completed: current upstream already owns NetEase/QQ Music/Kugou, canonical media models, unified audio-source resolution, external HTTP/WS control, and playback state. Provider registry/media mirrors/headless ports from bootstrap are rejected as unnecessary.
- Atom provider scope is reduced to Qobuz + Tidal. Phase 13 is now Qobuz-first because it is the simpler proof of first-class platform extension; Tidal follows after that pattern is proven.
- Rust 1.98.0 / Cargo 1.98.0 are installed under `~/.cargo/bin`; DevSpace native commands prepend that path explicitly.
- Full Linux native debug build succeeds for `audio-engine`, `audio-capture`, `media-ctrl`, and `opencc`.
- `cargo test -p audio-engine` passes 56/56, matching the Linux native test criterion used by upstream CI.
- `pnpm test:native` is intentionally not the Linux acceptance command: it pulls Windows-only taskbar crates and fails in `windows-future`; upstream CI runs the full workspace test on Windows and only `cargo test -p audio-engine` on Linux.
- Electron `better-sqlite3` rebuild succeeds after the earlier `--ignore-scripts` dependency install.
- Final regression remains green: `pnpm typecheck` passes and `pnpm test` passes 42/42 Node + 54/54 Web tests.
- Qobuz credential discovery is being simplified around the qobuz-dl-proven Web Player Bundle route: no runtime dependency on qobuz-dl, no qobuz-dl config import, no disk cache of discovered app secrets; environment credentials remain an explicit override.
- Implemented Atom-owned Web Player credential discovery with app-id + timezone/seed-derived secret candidates, in-memory winner reuse for signed requests, and updated Qobuz token validation to current `X-User-Auth-Token` + `user/get` semantics so `QOBUZ_USER_ID` is no longer required.
- Live Web Player discovery succeeds against the current site and returns four signing candidates without logging any secret values. Full regression remains green: Node 49/49, Web 54/54, typecheck, lint, production Electron/Vite build, and the upstream-touch budget all pass; upstream business-code touches remain 8.

### 2026-08-27：连接语义交叉验证（进行中）

- 已对照 `tinyLMS`、`slim2Diretta`、`DirettaRendererUPnP` 与 SDK 示例，确认四者都保留 `connectWait()`。
- 已确认 Atom 当前独有的“跳过 `connectWait()`，在播放前等待 `is_online()`”不符合这些实现的连接时序；下一步核实实际构建源文件与 tinyLMS-NEXT 调用证据，再制定最小修复。
- 本轮只做离线源码分析，未访问 Diretta Target。
- 已确认 `tinylms-next` 的可维护源码只在统一 Native 播放器上切换 `diretta` 后端；其具体 SDK 连接逻辑仅存在于保留二进制，后续不把不可审计的内部细节当作修复依据。
- 已通过 Git 历史定位回归点：`55fa9eb` 把 `connectWait()` 替换成了播放前 `is_online()` 轮询；正在寻找 SDK 支持的可退出等待方式，避免只恢复旧的潜在无限等待。
- 已完成最小 bridge 修复：恢复 `connectPrepare()` → `connect(0)` → `connectWait()`，删除播放前 online 轮询；未改格式、传输参数、Source Direct 数据路径或 Rust 播放生命周期。
- 已更新静态回归，明确 open 必须执行 `connectWait()`、不得等待 `is_online()`、不得提前 `play()`；无 SDK 聚焦测试 6/6 通过。
- SDK 149 实际编译/链接后的聚焦测试 5/5 通过；输出仅包含既有 SDK 头文件与 cfg 测试告警。
- 完整 Native 回归通过：无 SDK 101/101，SDK 149 96/96。
- 仓库级 `cargo fmt --check` 会要求重排多份未修改且已提交的 Rust 文件，属于当前 rustfmt 版本与基线的既有差异；未批量改动。`git diff --check` 对本轮全部差异通过。
- SDK 149 release Native 构建完成；`audio-engine` LTO 约 1 分 49 秒，四个 Native 模块全部构建成功，仅有既有 SDK 头文件告警。
- 新构建的 `audio-engine.node` 是有效 x86-64 ELF；动态段无 `TEXTREL`，依赖中无动态 `libstdc++`。下一步验证实际 Node 加载与导出，再执行单次 root 硬件检查。
- release addon 已由 Node 实际加载，`AudioPlayer`、`scanDirettaDevices`、`stageDirectNext` 导出存在；本机 `sudo -n` 可用，能够按硬性要求以 root 运行单次测试。
- 第一次 `sudo node` 在执行脚本前因 root PATH 中没有 `node` 退出，未扫描或接触 Target；改用 Node 绝对路径后才执行唯一硬件尝试。
- root 实测成功：唯一 DX5 II 被动态发现，PCM16/44.1 kHz `load(false)` 约 384 ms 完成，返回 paused/position 0/duration 0.12/volume 1；随后 stop，进程自然退出 0，无重试、无 SSH、无 Target 重启。
- root 完整生命周期实测通过：5 秒 PCM16/44.1 kHz/stereo 静音源 load-paused 成功，play 后位置 0.743 s，pause 保持 0.836 s，resume 后推进到 1.579 s，stop 后进程自然退出 0。
- 比例项目门禁全部通过：Node 72/72、Web 54/54、typecheck、ESLint、跳过重复 Native 编译的 production build、touch audit（31 business + 2 generated）与 `git diff --check`。
- 已删除一次性 Node 生命周期脚本和 5 秒静音测试文件；Target 由成功测试正常 stop/release，未执行 SSH 或重启。

### 2026-08-27：Diretta 下一轮硬件验收准备

- 用户已更新规则：不再逐次询问 Target 是否空闲；只在连接失败、占用状态可疑或测试无法继续时停止并沟通。开始执行下一轮 root 硬件验收。
- 第一次同步三份规划文件的 patch 因 hunk 格式错误未应用；已修正 patch 结构，没有重复无效内容或影响代码。
- 已恢复上一轮上下文：连接时序修复与证据已提交为 `81cb8fd`，工作区干净。
- 用户要求继续下一轮；先离线拆分 seek、同格式 gapless、PCM/DSD 格式切换、断连恢复与长稳测试，按风险由低到高准备一次性 root harness。
- 新的 Direct load 仍必须先取得用户对 Target 当前空闲状态的明确确认；“继续工作”本身不作为占用状态确认。
- 已离线生成第一轮临时 seek fixture/harness：单次 PCM load 内验证 paused seek 到 2.0 s、播放推进、playing seek 到 3.0 s 后自动恢复推进、stop 与自然退出。尚未运行或接触 Target。
- 已离线生成同 wire-format gapless 的两段 2 秒 PCM16 fixture/harness；它只用现有 `stageDirectNext`、`directTrackBoundary`、`commitDirectGaplessBoundary`，核对 generation 与跨边界后的第二轨位置推进。尚未运行。
- 两份 Node harness 语法检查通过；一次把三个文件同时传给单输入 `ffprobe` 的校验命令失败，改为逐文件探测，不重复该调用方式。该错误未访问 Target。
- root PCM seek 实测 PASS：paused seek 2.000 s；播放推进 2.557 s；playing seek 后推进 3.557 s；stop/自然退出 0。
- root gapless 音频与状态语义 PASS：stage=true、boundary generation=77、第二轨推进 0.464 s、stop 已调用。
- gapless 进程自然退出 FAIL：注册 `onEvent` 的 harness 在 stop 后仍存活，外层 45 秒 timeout 返回 124。已停止新的硬件 load，转入离线 NAPI callback 生命周期诊断；不重复相同 harness。
- 离线最小 Node 复现确认问题与 Diretta 无关：仅 `new AudioPlayer(); onEvent(() => {})` 即会让现有 addon 在 3 秒 timeout 后返回 124。检查 napi-rs 3.12.1 源码确认默认 ThreadsafeFunction 是强 event-loop 引用，`weak::<true>()` 才不会阻止退出；当前修复目标收敛为只把持久 `on_event` TSFN 改为 weak，并加自动回归，暂不触碰 Diretta bridge/teardown。
- 已完成 weak TSFN 修复与回归：硬件外最小复现 124→0；no-SDK 102/102、SDK 149 97/97；SDK release addon 复现同样自然退出 0。随后同一 root gapless harness 完整复测通过，generation 77 boundary、第二轨推进 0.464 s、stop 后自然退出 0。当前暂停点解除，继续 exact PCM format-change acceptance。
- exact PCM format-change root 验收 PASS：同一 DX5 II Direct 选择下 paused 加载 44.1k/16-bit/stereo FLAC，再 paused 加载 88.2k/24-bit/stereo FLAC；两次 metadata 都保持精确源 rate/channels/bit depth，第二次仍 paused/position 0，stop 后自然退出 0。该场景未调用 play；继续 Native DSD load/play。
- Native DSD root 验收在第一项 DSF/DSD64 LSB 即得到严格格式拒绝：DX5 II 正常唯一发现，但 `load(false)` 返回 `Diretta target does not support exact Source Direct Native DSD LSB format`；finally stop 执行，未触发外层 timeout，退出 1。未调用 play，未做 PCM/DoP、bit-order 或其它格式 fallback，也未第二次 load。按 Source Direct 规则停止后续硬件验收，转入离线确认该失败边界与当前 Target capability。
- 离线 bridge 核对确认该拒绝发生于 `checkSinkSupport(format)`，早于 `setSinkConfigure` 和 `connectPrepare/connect/connectWait`，因此没有建立 Direct 会话，不是连接/占用失败。尝试沿用已授权的只读 Target 配置诊断时，当前 DevSpace 的非交互 SSH 凭据被 `192.168.1.44` 拒绝（permission denied）；未读取或修改 Target，也不重复同一失败 SSH 调用。
- SDK 149 头文件确认 DSD LSB/MSB 是两个独立 Target capability 位，因此单独执行 DFF/MSB exact-source 验收是合理的能力测试而非 DSF fallback。root DFF/DSD64 10 ms fixture `load(false)` 成功，metadata 为 2.8224 MHz / 2ch / 1-bit / `dsd_msbf`；`play()` 后收到 ended，position=0.01、isFinished=true，随后 stop 正常结束。当前真实能力边界：DX5 II exact DSD MSB PASS，exact DSD LSB UNSUPPORTED；Atom 未改变源 bit order。
- PCM↔DSD(MSB) root 重连 PASS：同一进程 paused 依次加载 44.1k/16 PCM → DFF DSD64 MSB → 88.2k/24 PCM，三次 metadata/paused position 0 均正确，最终 stop 正常结束。
- 受控异常恢复的原 PASS 结论已撤销：外层 `timeout --signal=KILL` 只终止了 `sudo`，真正的 root Node 子进程仍带活动 timer 存活超过 8 分钟。后续 fresh reconnect 与长稳尝试都被该残留会话污染，不能作为异常恢复/长稳证据。已 TERM 清理该由测试创建的 PID 599495，并确认宿主无 root Node/harness 残留；Target 当前占用/会话状态需重新明确后才能继续硬件 load。正确 harness 必须让 timeout 直接包住 root shell 内的 Node，或显式定位并杀实际 Node PID，再用 `ps/pgrep` 证明无逃逸子进程。
- 第一次 180 秒长稳样本 `empty-seektable.flac` 也不合格：虽然 metadata 是 88.2k/24-bit、离线音量约 -91 dB，但 `ffprobe` 报 `invalid residual / decode_frame() failed`，`ffmpeg -xerror` 返回 183；Direct decoder 对该错误会把 ring 标记 failed。该轮 position=0/低网络流量不能归因于 S32 transport，结果作废。后续长稳应改用已实播通过的 44.1k/16 静音 FLAC，通过 same-wire-format staged gapless 循环延长时长。
- weak TSFN 修复的完整仓库回归已收口：Node 72/72、Web 54/54、no-SDK audio-engine 102/102、SDK 149 audio-engine 97/97、typecheck、ESLint、`SKIP_NATIVE_BUILD=true pnpm build`、SDK release addon、ELF（无 TEXTREL/动态 libstdc++）、upstream touch 31 business + 2 generated、`git diff --check` 全 PASS。当前代码改动仅 `on_event` weak TSFN + 一条回归 guard；其余未引入新架构面。
- 用户再次明确确认 DX5 II 空闲后，使用 root `timeout` 直接包住真实 Node 的纠正 harness 完成受控硬终止：PCM load/play 成功，4 秒后真实 root Node 被 KILL，`timeout_rc=124`，前后无 root Node 残留。1 秒后只运行一次 fresh reconnect，唯一 DX5 II 约 380 ms 发现、同一 44.1k/16-bit PCM paused load 约 380 ms 成功，随后 stop/自然退出 0；异常 Source hard-kill recovery 现正式 PASS。
- 长稳验收正式 PASS：同一 Direct 连接循环 stage/commit 已验证的 3.684717 秒 44.1k/16-bit 静音 FLAC，连续 50 个 boundary、总计 184.371 秒，无 `sourceError`/`outputFailed`。RSS 56.36→57.92 MiB、external 1.78 MiB 不变、播放期 threads=15、FD 32 稳定；br0 约 TX 36.54 MB。最终 stop/自然退出 0，宿主无 root Node 残留。
- 用户提供 `/media/extramusic` 的真实 DSD 库用于补充验收；当前枚举为 11 个 DSF、0 个 DFF/DSDIFF。真实 DSD64 DSF strict load 再次在 DX5 II exact LSB capability check 阶段明确拒绝，未 play、未转换、未 fallback，进程正常退出。该目录没有可用于 exact MSB 实播的 DFF，因此保留现有 10 ms DFF/MSB hardware PASS 作为受支持 Native DSD 证据。
- 用户要求先解决“真实 DSD 不能播”再继续 Qobuz/TIDAL。对照 `slim2Diretta` 与 `DirettaRendererUPnP` 后确认根因是 Atom 把 DSF LSB container representation 错当成必须保持的 Target wire representation；两个 proven oracle 都会在 Native DSD 域内依据 Target capability 做可逆 LSB↔MSB per-byte bit reversal。最小修复在一次 SDK open/连接前选择受支持 Native DSD wire order，Rust producer 在非 RT 预分配 slot 内仅在必要时 `reverse_bits()`；RT callback 仍只借 pointer+size，无 PCM/DoP/分配/转换。逐 bit 测试证明逻辑 DSD 序列不变，同 rate/channels DSF↔DFF handoff 可复用同一 wire order。
- 修复回归 PASS：no-SDK audio-engine 103/103、SDK 149 audio-engine 98/98，SDK release native build 完成。真实 DX5 II DSD64 DSF 以 2.8224 MHz / 2ch / 1-bit 加载，位置 0→1.509297→2.995374 s，pause 后稳定在 3.006984 s；真实 DSD256 DSF 以 11.2896 MHz / 2ch / 1-bit 加载，位置 0→1.213243→2.406168 s。两次均无 `sourceError/outputFailed`，stop 后无 root Node 残留。真实 DSF Native DSD 播放问题已修复，可继续 Qobuz/TIDAL 实机验收。
- Qobuz/TIDAL 实机验收目前停在账户前提而非音频路径：环境变量无 Qobuz user token/TIDAL OAuth token，用户目录也无 `qobuz.json`/`tidal.json` 持久化登录态。Qobuz Web Player app credential discovery 已实时成功，确认 app id 可发现且有 4 个签名 secret 候选；未输出 secret。故 Qobuz 只缺用户 auth token，TIDAL 只缺用户 OAuth access token；在用户凭据可用前不伪造共享账户、不宣称 live search/stream PASS。
- DSD 修复后的仓库级比例回归继续全绿：Node 72/72、Web 54/54、typecheck、ESLint、`git diff --check`、31 business + 2 generated touch audit、release ELF 无 TEXTREL/动态 libstdc++；最终宿主 root Node 审计为空。当前工作区保持未提交。
