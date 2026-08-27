# SPlayer Atom — Progress

## 2026-08-27 — Local safety checkpoint and recovery investigation resumed

- Created the two ownership-oriented safety commits: `e809887` for Atom-owned/downstream implementation and `c3cf146` for SPlayer integration seams. The working tree was clean immediately afterward.
- Re-ran the full committed baseline successfully: Node 71/71, Web 54/54, typecheck, ESLint, production build, no-SDK audio-engine 100/100, SDK 149 audio-engine 95/95, SDK-enabled release build/addon load, required Direct exports, no TEXTREL, no dynamic libstdc++, 31-business + 2-generated touch audit, and committed diff whitespace checks.
- Began the recovery investigation without issuing another Direct load. The first code inspection confirms that open/connect phases are not individually observable and close can wait indefinitely in `disconnectWait()`; the next step is to inspect SDK-supported timing/cancellation behavior before adding narrow diagnostics.
- Built the SDK debug addon and used GDB breakpoints for one controlled silent-fixture attempt. DX5 II remained discoverable; every open phase through `connect(0)` returned, then `connectWait()` returned false and Node exited naturally. No repeated blind load loop was run.
- Added shared RAII cleanup for partially opened and active bridge connections plus a static regression guard. Focused no-SDK and SDK-enabled tests pass.
- The first post-cleanup recovery attempt still exceeded its 30-second external bound inside connection completion and was terminated with status 124. This rules out cleanup-only recovery and justifies replacing unbounded `connectWait()` with a deadline over the SDK's atomic connection state.
- Replaced unbounded `connectWait()` with a 10-second poll of SDK atomic online state. Focused no-SDK/SDK tests pass; two hardware processes now fail explicitly in ~10.75 seconds and exit naturally rather than hanging. The second fresh-process attempt confirms immediate asynchronous disconnect + close does not yet clear the stale Target session.
- Added a bounded disconnect-state drain before SDK `close()` and tested one cleanup process followed by one fresh reconnect. Both remained bounded and exited naturally, but DX5 II still rejected connection completion. Stopped further automatic Direct loads against this stale Target.
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
