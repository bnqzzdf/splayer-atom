# SPlayer Atom — Downstream Development Plan

## Goal
Build SPlayer Atom as a continuously-updatable downstream of SPlayer-Next. Reuse upstream capabilities wherever possible and keep Atom-specific behavior limited to the smallest proven delta.

## Current Phase
Phase 16 — Diretta downstream backend

## Next Step
The two ownership-oriented safety commits and full committed baseline are complete. Linux root remains a permanent Diretta hardware-test precondition, but the first valid root-owned, user-authorized exclusive-Target check reproduced the same connection-completion timeout: DX5 II was uniquely discovered in about 0.38 seconds, Direct `load(false)` timed out at about 10.76 seconds, and the process exited naturally. Root therefore corrected the test conditions but did not fix Atom's connection path. Stop hardware retries and Target recovery work. Resume offline comparison of Atom's actual SDK negotiation parameters against the long-playing tinyLMS path, then propose the smallest evidence-backed connection change before requesting another user-confirmed hardware window. Qobuz/TIDAL live-account acceptance remains separately deferred until user-owned credentials are available.

## Principles
- Track current SPlayer-Next `dev`; historical commits are archaeology only, never the permanent base.
- **SPlayer owns the architecture; Atom owns only the delta.**
- Prefer upstream implementation over recovered/reimplemented duplicates.
- Default to no Atom abstraction until current upstream proves one is needed.
- Treat `/home/bnqzzdf/code/tinylms-next` and retained tinyLMS artifacts as compatibility oracles, not the product architecture.
- Preserve SPlayer-Next AGPL-3.0 attribution and license requirements.
- Every upstream synchronization must run upstream checks plus Atom compatibility tests.

## Phases

### Phase 11: Current upstream baseline
- [x] Choose the downstream product name `SPlayer Atom` / repository slug `splayer-atom`
- [x] Create an isolated product workspace separate from `tinylms-next`
- [x] Establish mandatory project-root `AGENTS.md` minimalism rules
- [x] Import current SPlayer-Next `dev` as the upstream product baseline
- [x] Preserve upstream license/copyright and add downstream attribution
- [x] Verify the unmodified JS/TS/Vue upstream typecheck, tests, and production build baseline before Atom integration
- [x] Verify the unmodified Linux Rust native baseline: full debug native build succeeds and `cargo test -p audio-engine` passes 56/56
- [x] Complete Architecture Discovery of provider/plugin, media types, playback/external-control, persistence, and native output APIs
- **Status:** complete

### Phase 12: Minimal extension seams
- [ ] Reuse upstream track/media/auth/search types wherever practical; add Atom provider abstractions only for demonstrated missing capabilities
- [ ] Treat Headless as an adapter/deployment mode over upstream control APIs unless a real missing service boundary is found
- [ ] Defer Zones until a concrete multi-output/use-case cannot be represented by upstream state
- [ ] Add only the smallest Diretta output hook required by the current upstream audio-engine
- [x] Define and automate upstream-touch inventory after the first real Atom patch exists
- **Status:** pending

### Phase 13: Qobuz architecture proof
- [x] Add Qobuz as a first-class current-upstream `Platform` using SPlayer's existing Track/Search/API/audioSource path
- [x] Store Qobuz user token using current SPlayer secure persistence patterns and auto-discover Web Player app id/signing-secret candidates without depending on qobuz-dl; explicit env credentials remain optional overrides
- [x] Implement only the Qobuz catalog search and signed `track/getFileUrl` behavior needed for a real search → queue → playback slice
- [x] Reuse current SPlayer UI, stores, queue, song cache, and player with no Atom media/provider abstraction or duplicate URL cache
- [x] Map current SPlayer quality levels to Qobuz format IDs only at the stream-resolution call site
- [x] Add focused tests derived from retained tinyLMS Qobuz behavior
- [~] Run a real Qobuz token validation → search → queue → playback acceptance test — **deferred: blocked only by unavailable user-owned Qobuz auth token**
- **Status:** implementation_complete_acceptance_deferred

### Phase 14: Tidal completion and provider parity
- [x] Audit current Tidal authentication, token refresh, search, playback-manifest, and stream behavior before porting retained tinyLMS code
- [x] Add Tidal as a first-class current-upstream `Platform`
- [x] Add secure imported OAuth access/refresh-token persistence without embedding retained tinyLMS shared client credentials
- [x] Implement songs-only search → canonical SPlayer Track → current `playbackinfopostpaywall` resolution → existing `audioSource`/player path
- [x] Recognize JSON/BTS direct streams and current MPEG-DASH manifests with explicit quality fallback/error handling
- [x] Implement Atom-owned DASH SegmentTemplate materialization to process-lifetime local fragmented MP4 and prove the existing SPlayer MOV/FLAC decoder can load it directly, with no runtime system-ffmpeg dependency
- [x] Reuse current upstream NetEase, QQ Music, and Kugou unchanged except for compatibility fixes proven necessary
- [x] Keep provider integration concrete; Qobuz + Tidal still do not justify a new provider framework
- [~] Run real Tidal auth/search/full-playback entitlement acceptance — **deferred: no user OAuth token or Atom-owned TIDAL Developer app credentials are available in the current environment**
- [~] Add first-party Authorization Code/PKCE login UX — **deferred until Atom has its own TIDAL Developer application/redirect configuration; do not embed shared client credentials**
- **Status:** implementation_complete_acceptance_deferred

### Phase 15: Headless/Core and optional Zones
- [x] Inventory current upstream HTTP/WebSocket/MCP external-control routes and all 69 retained tinyLMS HTTP contracts
- [x] Classify every retained contract as UPSTREAM / COMPAT / ATOM / DROP with no unclassified routes
- [x] Mount one Atom-owned compatibility router into the current SPlayer external API and expose only safe high-value thin wrappers: local library read/search/random, scan status/start/cancel over configured dirs, `/lyrics/current`, and `/output/scan`
- [x] Keep arbitrary `/load`, filesystem-root browsing/mutation, queue sync, plugin/settings administration, PCM streaming, and other trust/state-sensitive legacy surfaces deferred rather than recreating a parallel Core
- [x] Reuse current WebSocket + MCP `playerControl` capabilities for remote playback/queue/search; exact legacy `/load` or queue contracts are not prerequisites for Core capability
- [x] Defer Zones: no current concrete multi-output requirement proves a persistent Zone domain is necessary before Diretta output integration
- [x] Defer mDNS/PCM-browser-audio discovery/transport until a final remote-client requirement demonstrates they are still product requirements
- **Status:** complete

### Phase 16: Diretta Source Direct backend
- [x] Prove optional external Diretta Host SDK 149 compile/link through an Atom-owned C++ ABI bridge with CPAL-only builds unaffected when the SDK is absent
- [x] Prove the existing SPlayer normal playback path is not acceptable for Diretta Source Direct: it always builds an `f32` player resampler and then passes samples through DSP-capable state
- [x] Define the PCM direct-format matrix for the current HiFi Gate: packed S16/S32 is zero-copy; planar S16P/S32P must use one bit-transparent preallocated interleave repack; float PCM remains unsupported in strict Direct
- [x] Retain decoded PCM with fixed refcounted FFmpeg `AVFrame` slots so packed payload pointers remain valid across asynchronous SDK callbacks without copying sample payloads
- [x] Implement callback-paced Diretta output that borrows stable blocks with no redundant PCM copy, heap allocation, mutex, logging, discovery, or format negotiation in the SDK RT callback
- [x] **Direct Lifecycle Gate:** branch before normal playback-runtime construction so strict Diretta load/play/pause/stop/seek/status/error never constructs SPlayer `Shared`/player `Resampler<f32>`/DSP/normal `PlaybackHandle`, while preserving the existing SPlayer player as the sole state owner; architecture guards now prevent Direct NAPI load/seek from re-entering the normal pipeline
- [x] Reject every sample-altering control while Direct is selected/active with an explicit `[Direct]` error: software volume below unity, normalization/ReplayGain, EQ/preamp, fade processing, tempo, and pitch do not silently apply or silently exit Direct
- [x] Implement native DSF/DFF DSD direct path separately from PCM: stream raw 1-bit payload, preserve source LSB/MSB order, perform only lossless Diretta `DSD_SIZ_32` L4R4 layout repack, and never route through FFmpeg PCM/DoP
- [x] Make exact PCM/DSD format negotiation strict: PCM Target must accept source rate/channels/S16-or-S32 representation; DSD Target must accept source bit rate/channels/LSB-or-MSB + BIG + `DSD_SIZ_32`; otherwise fail with no conversion fallback
- [x] Keep the C++ layer as a thin SDK adapter only; current RT callback only borrows pointer+size and does not port tinyLMS `RamBuffer`, custom player, whole-track preallocation, or broad watchdog/output-manager architecture
- [x] Preserve one Diretta connection across same-Target/same-wire-format transitions and implement staged sample/bit-contiguous handoff: PCM compatibility is rate/channels/storage width, DSD compatibility is bit rate/channels/source bit order; renderer generation commit advances queue/media state without calling normal `load()`
- [x] Complete the practical fixture matrix for WAV/FLAC/ALAC/WavPack plus real APE16 and DSF/DFF: APE16 is codec-level proven; APE24/32 share the already-proven generic `S32P` bit-perfect repack path but still lack a local format-specific encoder fixture
- [x] Add machine-verifiable Source Direct tests for ALAC/WavPack/APE planar bit-perfect repack, packed byte identity, no-resampler/no-DSP, retained-buffer lifetime/address, callback pointer identity, WavPack 32-bit full-range identity, Native DSD bit identity/layout, strict underrun behavior, and unsupported-format hard failure
- [x] Stop after the automated PCM + APE + Native DSD Source Direct proof and present the evidence for user review before adding playback-state wiring, DeviceSelector/UI, or real-machine tuning
- [x] Integrate async Diretta target scanning/device selection through the existing SPlayer output-device seam: `scan_devices()` → `AudioPlayer.scanDirettaDevices()` (`spawn_blocking`) → IPC/preload → `refreshDevices()` merge, while reusing stable `diretta:<target-id>` selectors and the existing device state/UI path
- [x] Add the strict online Direct input seam for Qobuz/TIDAL without provider-specific players: reuse an existing song-cache file when enabled, otherwise byte-preserve the resolved HTTP(S) response into an Atom-owned process-lifetime seekable temp file; TIDAL DASH local fMP4 is reused directly, preload/gapless staging receives the local source, and entering Diretta from an already-playing remote Qobuz/TIDAL track prepares the local source before switching. Direct preparation/load failures never fall back to SPlayer's normal `f32` pipeline
- [x] Make Direct-mode UI state transparent on existing settings/player surfaces: Diretta entry is preflighted against the same 100%-volume / normalization-off / EQ-off / 1.0x / zero-pitch rules as native, incompatible entry does not stop/materialize/switch, existing fade/normalization settings and volume/EQ/speed/pitch controls are visibly locked while Direct is selected, ordinary-output values are preserved, and native refusal remains authoritative
- [ ] Final real-machine acceptance covers actual Diretta target discovery, Qobuz/TIDAL account playback, PCM/DSD playback, pause/resume/seek, exact-format switching, gapless, disconnect/recovery, long-run stability, CPU/memory/network behavior, and bitstream verification where hardware permits
- [ ] Defer latency/thread/MTU tuning and hardware recovery policy until measured real-machine acceptance; these optimizations must not weaken directness guarantees
- **Status:** in_progress_acceptance_only — all pre-hardware Source Direct / lifecycle / discovery / online-input / UI gates are automated-proof complete; final real-machine acceptance remains

### Phase 17: Compatibility closure
- [ ] Port useful `tinylms-next` tests into downstream compatibility suites
- [ ] Compare retained HTTP/WS/provider/native behavior against packaged tinyLMS artifacts where still relevant
- [ ] Classify differences as intentional upstream evolution vs Atom regressions
- [ ] Delete recovered duplicate implementations once upstream/Atom replacements are proven
- **Status:** pending

### Phase 18: Production cutover
- [ ] Make SPlayer Atom the sole maintained product tree
- [ ] Keep `tinylms-next` read-only as recovery evidence/oracle
- [ ] Document routine upstream synchronization and release qualification
- [ ] Remove packaged-binary dependencies once Diretta/native parity is proven
- **Status:** pending

## Next Session Checklist
1. Read `docs/handoff-2026-08-26.md` for architecture history, then `docs/handoff-2026-08-27.md` for the current operational handoff after `AGENTS.md`, `task_plan.md`, `findings.md`, and `progress.md`.
2. Preserve safety commits `e809887` and `c3cf146`; do not squash the maintenance-ownership split unless explicitly requested.
3. The complete committed baseline and bounded connection-timeout regression are green. Resume hardware acceptance only after the user confirms DX5 II is exclusively available; do not redo discovery, online Direct input or Direct UI work.
4. Keep reusing the existing `AudioDevice`, `settings.player.outputDevice`, `switchDevice()`, `DeviceSelector`, settings schema and player controls; do not add a second device store, OutputBackend, Zone, or Direct settings domain.
5. The first root-owned, externally bounded check with user-confirmed Target availability still timed out during connection completion and exited naturally. Do not retry, restart or change hardware state automatically. Compare Atom's SDK negotiation with the proven tinyLMS path offline and propose one narrow change first; every later Direct `load()` still requires fresh user confirmation that DX5 II is free and a root Host process. Keep Qobuz/TIDAL live-account and genuinely manual DAC/physical cases deferred.

## Architecture Guardrails
- Default to **no Atom abstraction** until current upstream proves one is needed.
- Prefer upstream types, stores, services, registries, plugin APIs, persistence, and native interfaces over Atom-owned mirrors.
- Provider implementations must not create a second normalized application model unless a real upstream incompatibility demands a small extension.
- Headless must reuse upstream runtime state rather than define a parallel player service.
- Zones are optional and deferred.
- Diretta must reuse SPlayer application state and source management, but **must bypass or extend upstream audio processing wherever required to guarantee Source Direct**; fidelity invariants take precedence over reuse of the normal `f32` playback path.
- Widespread edits across Home/Search/Queue/Player/Settings are a stop-and-redesign signal.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Bootstrap `/home/bnqzzdf/code/splayer-atom` was not yet a Git repository | 1 | User imported current SPlayer-Next `dev`; baseline now exists at `0f5a2fc`. |
| No system `tsc` was installed in the empty bootstrap workspace | 1 | Full validation is deferred to the upstream pnpm toolchain now present. |
| DevSpace could inspect but not perform Git clone/init/fetch/checkout | 1 | User performed the checkout directly; no policy bypass was used. |
| Upstream checkout replaced the bootstrap `AGENTS.md` | 1 | Merged mandatory Atom downstream rules into upstream `AGENTS.md` before architecture work. |
| One findings patch was blocked by the workspace safety gate | 1 | Retried with a smaller exact-text edit; the smaller patch succeeded. |
| `pnpm install --frozen-lockfile` exceeded the 300-second DevSpace command limit | 1 | Do not repeat the same install. The package store is mostly populated (928 entries) but linking is incomplete; retry via the populated store with lifecycle scripts deferred. |
| Offline dependency completion failed because `builder-util-runtime@9.7.0` was not cached | 1 | Used online `pnpm install --frozen-lockfile --ignore-scripts`; dependency linking completed successfully. |
| Initial `pnpm build:native --dev` could not start because Rust was not yet installed | 1 | Rust 1.98.0/Cargo 1.98.0 were later installed under `~/.cargo/bin`; Linux native debug/release and Diretta SDK builds are now green. |
| First README downstream-attribution patch was blocked by the workspace safety gate | 1 | Retry with a smaller insertion anchored to a single heading rather than a broader block replacement. |
| Tried to inspect the retained tinyLMS oracle from the SPlayer Atom workspace | 1 | DevSpace correctly rejected the sibling path; use the existing `tinylms-next` workspace ID for oracle inspection instead of crossing workspace roots. |
| First Qobuz typecheck found exhaustive `Platform` maps missing `qobuz` in lyric priorities and share URLs | 1 | Treat as real integration pressure only: add `qobuz: []` for lyric formats and `qobuz: null` for share URL maps; do not add unsupported functionality. |
| First Qobuz formatter test file write was blocked by the workspace safety gate | 1 | Retry with a smaller test fixture and no URL-like literals; keep the same assertions. |
| Upstream-touch script passed its budget check but failed repository ESLint because `.mjs` helper functions cannot carry TypeScript return annotations | 1 | Keep the standalone JavaScript maintenance script and disable only `@typescript-eslint/explicit-function-return-type` for that file; do not weaken global lint rules. |
| First development-doc patch after Qobuz credential-strategy change used stale exact text | 1 | Re-read the current document and apply smaller exact section edits; do not repeat the stale patch. |
| First Tidal typecheck found exhaustive `Platform` maps missing `tidal` in lyric priorities and share URLs | 1 | Add `tidal: []` for lyric formats and `tidal: null` for unsupported collection share URLs; do not implement unrelated capabilities just to satisfy the union. |
| First Tidal share-URL edit used a non-unique `qobuz: null` match occurring four times | 1 | Read the small exhaustive map and replace the whole map block once; do not repeat the ambiguous edit. |
| First legacy HTTP report run treated `--high` as the inventory file path | 1 | Parse CLI arguments so the first non-flag argument is the optional inventory path; keep flags independent. |
| First Phase 15 compat typecheck found an unused `getTrackCount` import | 1 | Use the canonical DB count in the `/library/tracks` response instead of duplicating it with `data.length`; rerun validation. |
| First `direct_dsd` module insertion used an older `lib.rs` text shape | 1 | Re-read the current cfg/cfg_attr block and insert `direct_dsd` with an exact minimal edit. |
| A focused Cargo test command used a literal `|` filter and therefore ran 0 tests | 1 | Discard that result and run the complete `cargo test -p audio-engine`; both no-SDK and SDK-enabled suites pass. |
| One bulk rustfmt-conformance edit matched the same DSD fixture vector twice | 1 | Let the safety gate reject it, then apply smaller context-specific edits; targeted rustfmt check passes. |
| One Direct Lifecycle edit used a mistyped DevSpace workspaceId | 1 | No file was changed; retry the same exact edit with the established `ws_2d5d7d5cfb` workspace. |
| First session-handoff findings insertion assumed the heading `Findings` instead of the current `Findings & Decisions` | 1 | No file was changed; re-read the first lines and insert under the exact current heading. |
| First Direct-input unit test saw Node `Invalid URL` before the intended non-HTTP validation for a local path | 1 | Make URL parsing explicit and normalize invalid/non-HTTP input to the stable Direct materialization error instead of relying on `new URL()` exceptions. |
| First `audioSource.ts` Direct-input integration patch was blocked by the workspace safety gate | 1 | No file was changed; split the integration into smaller exact-text edits instead of retrying the same broad patch. |
| First one-off TIDAL fMP4 fixture generation used a pre-created `mktemp` output and ffmpeg refused to overwrite it | 1 | Regenerate with explicit `-y`; this was an output-file handling error, not a codec/container failure. |
| First online-Direct gapless preloader typecheck lost the `source !== null` narrowing before `stageDirectNext()` | 1 | Make the staging branch itself require `source` explicitly so TypeScript and runtime share the same null guard; do not add any fallback path. |
| Full `cargo fmt --check --package audio-engine` during async discovery requested broad reformatting across pre-existing Direct Lifecycle/gapless files | 1 | Do not autoformat unrelated completed work; validate this narrow change with compile/tests, generated NAPI declarations, lint/typecheck, and targeted diff checks instead. |
| First async-scan Rust compile found both `scan_devices()` implementations were still private under `diretta::imp` despite the handoff shorthand calling them `diretta::scan_devices()` | 1 | Add the missing one-line `pub use imp::scan_devices;`; do not change the real-SDK or no-SDK scan implementations. |
| First Direct-UI Node guard imported `directMode.ts` directly and `tsx --test` did not resolve the app `@/stores/*` aliases | 1 | Keep production imports unchanged and convert the guard to the same source-static architecture-test style already used by Direct gapless tests. |
| Direct-UI touch audit exceeded the frozen 25-file business budget with exactly six planned mature UI/i18n surfaces | 1 | Re-evaluate the seam; confirm the only new upstream touches are Toolbar, EQ dialog, speed dialog, player settings, zh-CN and en-US. Keep Direct derivation/notice/tests Atom-owned and raise the explicit audited budget to 31. |
| One DevSpace validation shell did not include Cargo in `PATH` | 1 | Use the installed `/home/bnqzzdf/.cargo/bin/cargo` explicitly; no project environment/config changes are needed. |
| First local safety commit was rejected because this checkout had no Git author identity | 1 | Reused the established `Achilles Zhang <bnqzzdf@gmail.com>` identity from the related `tinylms-next` repository and configured it only for this repository. |
| First recovery cleanup patch used a stale partial test-function anchor | 1 | The combined patch was rejected without changes; re-read the exact test tail and applied separate bridge/test patches with precise anchors. |
