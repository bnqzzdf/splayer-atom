# SPlayer Atom — Current Progress

## 2026-08-30 — Formal SPlayer Atom release identity

- Formalized the product as **SPlayer Atom** with an independent `0.1.0` version line, `splayer-atom` package/repository identity, `io.github.bnqzzdf.splayer-atom` Desktop appId/NSIS GUID, Atom-only updater cache/release URL/publish target, and Atom CI artifact labels.
- Reduced the formal update model to **stable + beta**. Stable maps to electron-updater's technical `latest.yml` manifest; Alpha is removed from builder validation, release workflow, manifest aliasing and Settings UI rather than remaining as a hidden third product channel.
- Added a hard release-identity regression gate that rejects SPlayer-Next publish/updater targets and verifies Atom installation/repository/channel identity. The upstream touch audit now reports unavoidable packaging/updater plus user/third-party identification changes as a separate fixed **14-file product/release-identity seam**, while the established business/runtime/Core-authority budgets remain 105 / 22 / 13.
- Core release provenance now records `productName`, Atom version/commit, `sourceDirty`, accepted SPlayer baseline, Node/protocol/schema/capabilities and Diretta metadata. `/api/info` projects the same version/commit/dirty/baseline; Desktop packaging injects equivalent commit/dirty/baseline metadata into the packaged app.
- Renamed Core artifacts to `splayer-atom-core-system-linux-x64.tar.gz` and `splayer-atom-core-bundled-linux-x64.tar.gz`. Both variants were rebuilt and passed the real extracted final-artifact smoke with the new identity contract; the current local archives correctly report `sourceDirty: true` because the worktree is uncommitted.
- Kept `orpheus://` out of mechanical branding changes and resolved installer ownership safely: Atom packages no longer statically register the scheme on Windows/macOS/Linux. The upstream-compatible runtime handler remains default-off and registers only after explicit user opt-in, so installation itself does not steal SPlayer-Next's protocol association.
- Completed real Desktop packaging evidence with native rebuild intentionally skipped after the existing production outputs: `dist/linux-unpacked/splayer-atom` packages successfully, its asar metadata contains `splayer-atom` / `SPlayer Atom` / `0.1.0`, Atom commit + `atomSourceDirty` + SPlayer baseline + Atom repository/bugs URLs, and a real `dist/splayer-atom-0.1.0-x86_64.AppImage` plus `latest-linux.yml` references only Atom assets.
- Formal release workflow now refuses non-`bnqzzdf/splayer-atom` repository context or a dirty source tree. The stable/beta release-assets script was executed locally with its real `js-yaml` dependency and passes 3/3 cases (stable aliases to beta, beta only, alpha rejected).
- Runtime-facing product identification now says SPlayer Atom for MusicBrainz UA, Jellyfin/Subsonic client identity, Desktop lyric title and About contributors, while MCP keys/Kugou MID/plugin documentation remain explicitly classified compatibility surfaces rather than blindly renamed identifiers.
- About now reads shared `getCoreInfo()` and shows Core version, Atom commit, accepted SPlayer baseline, Core Protocol, source-tree dirty state and Core Node runtime. A dedicated protocol regression proves product-version differences do not affect compatibility when Core Protocol v1 matches.
- Full repository validation after this release-identity sweep passes **Node 280/280, Web 84/84, Node/Web typecheck, ESLint, Prettier, `git diff --check`, touch audit 105 / 22 / 13 + release-identity 14/14**. The same final code state also passes Desktop production `electron-vite build` and fresh extracted-artifact smoke for both `splayer-atom-core-system-linux-x64.tar.gz` and `splayer-atom-core-bundled-linux-x64.tar.gz`.

## 2026-08-30 — Core-only download destination

- Product scope now explicitly excludes Control-local music downloads. Shared `DownloadRequest.destination` is the literal `"core"`; the Headless/Core route accepts only that destination and shared Desktop/Web download flows always emit it.
- Key download UI copy now says “下载到 Core / Core Downloads” for single-track actions, batch actions, navigation, page title and queue/toast status, so a remote Web Control cannot imply that media lands on the browser device.
- Focused Core download tests, Web `downloadClient` tests and Node/Web typecheck pass after the contract change. Roadmap §16 closes the old “Core vs Control destination” item as a Core-only product decision rather than a deferred local-download feature.

## 2026-08-30 — Headless Web software reachability

- Confirmed production Web does not use the retained diagnostic `HeadlessApp`: `/debug` is the only path mounting it, while normal browser runtime calls `mountSPlayer(true)`, installs the Web Core facade, and mounts the same `App`/router/Pinia Control UI as Desktop.
- Added regression coverage for shared Web Library/Search/session playback and for Netease Favorites/Daily/Cloud software paths. Account pages reuse provider session state plus the shared `providerClient`; Cloud local upload remains correctly hidden behind `cloudUpload` instead of a browser fake implementation.
- Roadmap now separates software reachability (closed) from real-account Favorites/Daily/Cloud data acceptance (still pending and credential-dependent).

## 2026-08-30 — Bundled Node Core artifact

- Added `--bundle-node` to the existing Core build/staging/final-artifact pipeline. It does not create a second Core flavor: the same JS/native/Web/data layout is staged, with the exact reference Node `24.18.0` added only at `runtime/bin/node`.
- `runtime.json` records `nodeBundled`; the formal Atom-named technical artifacts are `out/splayer-atom-core-system-linux-x64.tar.gz` and `out/splayer-atom-core-bundled-linux-x64.tar.gz`.
- Final bundled-artifact smoke runs the normal launcher without an `ATOM_NODE_BIN` override and verifies `/proc/<pid>/exe` resolves to the staged `runtime/bin/node`, then runs the same info/session/library/cache/Web/SIGTERM checks. A real bundled build passed this gate.
- Bundled staging also carries the Node distribution `LICENSE`, and the final artifact gate rejects a bundled archive missing either the Node executable or its license.
- Updated build/deployment docs and Roadmap; system-runtime remains the default deployment variant and bundled-runtime is optional convenience only.
- Added bundled staging/final smoke to the existing `Core System Gate` after the normal system artifact build, reusing already-built native/Core/Web outputs instead of doubling the expensive build. The workflow definition and local gates pass; the new hosted bundled step awaits the next pushed clean run for remote evidence.
- Final repository validation after the CI wiring passes at Node 269/269, Web 84/84, Node/Web typecheck, focused Prettier/ESLint, `git diff --check`, touch audit 105 / 22 / 13, and the same production Desktop build state; both system-runtime and bundled-runtime tar variants also passed real local final-artifact smoke.

## 2026-08-30 — Headless generic config surface removed

- Audited Core/Headless `/config` consumers after the Settings authority split. Production Web no longer calls it, Desktop uses local Electron config IPC, `/debug` does not depend on it, and the retained legacy HTTP inventory specifies only future allowlisted `/settings` compatibility.
- Removed generic HTTP `GET /config` and `POST /config` from the shared Core router instead of preserving a high-authority whole-store read/write endpoint. `/settings/core` and dedicated Library/Output/Cache/Download APIs remain the only Core settings/domain surfaces; Web This-Control persistence stays local allowlisted state.
- Focused Settings/Core Protocol/session tests and Node/Web typecheck pass after removal. Existing Direct-boundary tests also prove the adjacent P4 materialize-hardening item is already satisfied: no Headless materialize route and no renderer/preload Direct staging API remain, so that stale Roadmap checkbox was closed without new production code.
- Full repository validation follows before the next checkpoint.

## 2026-08-30 — Deterministic online playback acceptance

- Added an isolated Node 24 module-mock harness that executes the real authoritative `playbackSession` while faking native/player/provider/storage edges; no production dependency-injection seam was added.
- Verified a three-track Netease queue advances entirely from Core native-ended handling with no Control callback, including next-track preload scheduling.
- Verified source recovery semantics behaviorally: the current online Track gets exactly one fresh resolve; a second `sourceError` advances, and a failed fresh resolve also advances to the next canonical queue item.
- Wired the harness into the default Node test suite. Node baseline is now 267/267 and `typecheck:node` passes.
- Closed the Netease `fee=4` classification gap: Core now emits `NETEASE_PURCHASE_REQUIRED` for digital purchase restrictions while `fee=1` remains `NETEASE_VIP_REQUIRED`; both translations and skippable playback policy are covered by tests.
- Extended the same real-session harness with playlist `PlaybackContext` plus fake ALSA → Diretta switching. It verifies HTTP materialization/reload for Diretta and confirms the next online track still advances through Core native-ended handling.
- Restored upstream `src/settings/categories/services.ts` and centralized Atom ProviderAccounts/Web service filtering in the existing schema seam, funding the new shared error code without increasing the 105 business-touch budget.
- Roadmap §6/§7 software-verifiable auto-next, continuous playlist, expired-URL recovery, output-switch combination, and `fee=4` distinction are now closed. Headless upstream-page acceptance and real hardware gates remain separate.
- Final validation for this slice passes: Node 268/268, Web 84/84, Node/Web typecheck, focused Prettier/ESLint, `git diff --check`, touch audit 105 / 22 / 13, and Desktop production `electron-vite build`.

## 2026-08-30 — Netease Node API to `ncm-api-rs` feasibility research

- Started a read-only assessment requested by the user.
- Preserved the unrelated dirty Settings convergence worktree and limited writes to the existing planning files required by the research workflow.
- Next: inspect the authoritative roadmap and current Netease integration, then compare the external Rust repository's contracts, deployment model, and feature coverage.
- Confirmed the existing implementation is vendored source rather than an npm dependency and has a strong single entry seam at `callNetease(name, params)`.
- Captured the exact roadmap acceptance surface that any replacement must preserve.
- Mapped the current facade/session/error/cache/proxy responsibilities and separated the small playback-critical API set from the broader UI/account API set.
- Cloned and inspected `ncm-api-rs` at commit `133b65b`; confirmed both library and HTTP-server modes and identified crypto/session areas requiring source-level parity checks.
- Read the actual server/request implementations and found nontrivial session, parameter-flattening, URL-version, anonymous-registration, and scrobble differences behind the broad route-name coverage.
- Quantified route-name overlap and mapped the user-facing Netease feature surface that would need regression coverage for a full swap.
- Assessed Atom packaging options and the Rust project's test/server generation code; identified missing HTTP cloud routes and a large authenticated parity-test gap.
- Verified the Rust crate and optional server feature compile successfully without executing live provider calls.
- Verified a release server binary also builds successfully and compared response/error normalization with Atom's current request layer.
- Smoke-tested the release binary on loopback, measured its initial footprint/dependencies, and checked current GitHub repository/release activity.
- Ran a batch endpoint/crypto comparison and confirmed a compatibility mapping layer is necessary even where both projects expose similarly named methods.
- Confirmed concrete gaps in xeapi like, proxy-aware recognition, NCM-BL scrobbling, and a currently open upstream playlist mutation failure.
- Completed the decision: conditionally feasible through the existing `callNetease` seam and a pinned Rust sidecar, but not a drop-in or sensible one-shot rewrite.
- Estimated 2–4 engineer-days for a narrow PoC, 8–12 for a Linux playback slice, 20–30 for full Linux Core parity, and 30–45 for full Core/Desktop cross-platform replacement, with about ±35% uncertainty.
- No product source or test files were changed; only the pre-existing planning records were updated as required by the research workflow.
- Removed 4.1 GiB of temporary Rust build artifacts with `cargo clean`; the remaining temporary source checkout is 2.3 MiB.

## 2026-08-29 — AGENTS guidance compressed and corrected

- Reconciled the complete `AGENTS.md` against the full current roadmap and current Core/Control source seams.
- Replaced the stale Electron-main/renderer-IPC architecture snapshot with the Node Core / Control / Output authority model.
- Removed the obsolete Windows Git-Bash assumption, incomplete platform/type inventories, old storage tree, duplicated subsystem descriptions, and phase-like statements.
- Kept strict Diretta Source Direct, upstream-minimalism, provider ownership, trusted-LAN scope, Git/vendor workflow, release/runtime, memory, persistence, formatting, and validation rules.
- Reduced `AGENTS.md` from 2593 to about 1600 words; focused Prettier, stale-pattern, referenced-document, and whitespace checks pass.

## 2026-08-29 — Historical records archived

- Removed obsolete claims about restricted devspace Git access.
- Archived the accumulated task plan, findings, progress log, and four dated handoff snapshots under local `history/`.
- Added `history/` to `.gitignore` so archived session material no longer affects repository status or future agent context.
- Recreated concise root `task_plan.md`, `findings.md`, and `progress.md` containing only current state and decisions.
- Updated the roadmap documentation map to distinguish current working files from ignored local history.

## 2026-08-30 — Settings ownership convergence started

- Resumed from `9823f41` and the §16 terminal audit instead of continuing generic IPC removal.
- Confirmed the next real gap is Settings ownership: shared UI currently funnels every backend-bound setting through generic `config:set`/`/config`, mixing Core Domain and Desktop Host side effects.
- Chosen first slice: add an explicit Core-setting classifier and shared Core settings client/service; Core mutations move to the Core Protocol while Desktop-only settings stay on Electron config IPC.
- Added the shared ownership classifier, `coreSettings` service with playback/preload side effects, an engine fade sync helper, and the renderer `settingsClient`; shared Core mutations now use `/settings/core`, while Web's generic `/config` rejects Core paths.
- An attempted Desktop `config:set` guard exceeded the upstream business touch budget (106 > 105), so that upstream IPC edit was fully reverted. The final slice stays within 105 / 22 / 13 and leaves the legacy Desktop config handler unchanged while removing it from the production shared Core-setting path.
- Validation passes: focused Core Settings tests 4/4, full Node 259/259, Web 84/84, Node/Web typecheck, focused Prettier/ESLint, `git diff --check`, touch audit 105 / 22 / 13, and Desktop production `electron-vite build`.
- Added the read-side contract without prematurely switching consumers: GET `/settings/core` returns a typed `CoreSettingsSnapshot` containing only Core-owned settings, and `settingsClient.getSnapshot()` is shared by Desktop/Web. Host/Control-local/Plugin settings are intentionally absent.
- Completed the consumer read split: `syncSystem()` now merges the current Control snapshot with `settingsClient.getSnapshot()` and applies Core values last, so startup/recovery no longer depend on a mixed Core/Host Web snapshot.
- Added explicit Web This-Control persistence for onboarding/agreement/UI Zoom. Web `ConfigApi` no longer requests Headless `/config`, rejects every Core-owned path plus unowned Host/Desktop paths, ignores stale local entries outside the allowlist, and reapplies browser zoom after reload.
- Closed residual fake Host surfaces exposed by the stricter boundary: Web hides Desktop-only media/Discord/Last.fm/External API and AI/MCP/Plugins Settings, while FontConfig no longer writes external-lyric Host paths without the matching capability.
- Focused Settings/Control validation after the read split passes 21/21 tests plus Node/Web typecheck; touch audit is restored to 105 / 22 / 13 after moving Web zoom into the existing Atom Control seam rather than adding a new upstream NavHeader touch.
- Completed the §16 Plugin Core Control gap: added an Electron-free plugin control service, shared `/plugins/*` routes/client, and `pluginStatus` on the unified Core event envelope. Desktop preload forwards all plugin business calls except local-path install/native picker through `atom-core://control`; Web uses the same Core client and exposes installed/market UI while hiding only the local import picker section.
- Plugin projection now loads for both Desktop and Web before normal playback use. Focused Settings/Plugin/Core-event validation passes 30/30 tests, Node/Web typecheck passes, and touch audit remains 105 / 22 / 13.
- Completed the remaining §16 Web Host/presentation capability audit: Recognition is gated by `musicRecognition`; Cloud browse/play remains available while local upload is gated by `cloudUpload`; native OpenCC lyric conversion is gated by `nativeCjkTransform` and its setting is removed in Web. General/Appearance gating moved into the shared schema aggregation so their category files could return to upstream and fund the two new UI touches without raising the 105 business budget.
- Repository validation before this final capability slice was Node 266/266, Web 84/84, Node/Web typecheck, focused Prettier/ESLint, `git diff --check`, touch 105 / 22 / 13, and production Electron build PASS. The final capability slice has separately passed 27/27 focused tests, typecheck, formatting/lint, and touch audit; the full suite/build is being rerun for the final checkpoint.

## Current Delivery State

- Core comments, library file operations, filesystem paths, Download authority, cache, deployment, migration safety, CI artifact generation, and Diretta SDK 149 provenance are implemented at their current checkpoints.
- Latest recorded full validation: Node 283/283, Web 84/84, Node/Web typecheck, ESLint, current-change-set Prettier, `git diff --check`, touch audit 105 / 22 / 13 plus product/release-identity 14/14; renamed Core system/bundled artifacts and a real SPlayer Atom Linux AppImage have passed local artifact/package validation.
- Network proxy testing and audio-output reinitialization use real Core paths from Web; the Host no-op reachability audit is now closed. Web hides Desktop file-explorer actions, exports lyric posters through browser download, and no longer initializes Desktop updater/window/lyric subscriptions without the corresponding Host capability.
- Extended the shared `ControlAction` model from Track to Collection detail (playlist/album), Artist, and optional CoverList presentation. Collection/Artist primary+overflow actions and Favorites playlist/album/artist card unsubscribe derive from shared semantic actions while existing execution services remain authoritative; purely navigational cards intentionally stay click-only.
- Ownership-oriented checkpoint commits were pushed through `fd5671f`; hosted `Core System Gate` evidence remained green through `be96ad6` (run `33249130671`). Both `02d761d` and `a6df408` were rejected before runner allocation because GitHub reported the same account billing/spending-limit block; no workflow step executed, so this remains external CI infrastructure rather than a code regression.
- A separate manual `Core Diretta Release Gate` now defines secure SDK-enabled release validation: controlled self-hosted Ubuntu 24.04 x86-64 runner, `diretta-sdk-149` label, SDK 149 pre-provisioned read-only outside the checkout, and existing `--require-diretta`/Release.hpp checks. The `diretta-release` Environment now exists with a `dev`-only deployment policy; only trusted runner registration remains before the first remote SDK-enabled run.
- Continued Desktop/Core transport convergence: Desktop `atom-core://control` and Headless Web share one `buildCoreControlRoutes()` contract. Playback/session/output, Managed Provider, active Library requests, and distributed Player helper requests now use shared Core clients. FFT enable/read, local HD cover and external lyric reads no longer use Player IPC; remaining Player IPC is tray/thumbar Host presentation plus `onEvent` event transport. Desktop directory/cover pickers remain explicit Host actions and scan progress remains event transport. Renderer-facing Direct stage/cancel/commit/materialize APIs and the dead renderer Direct preload state machine remain removed, leaving Direct ownership only in Core.

## 2026-08-30 — Current worktree commit organization

- Resumed from the actual Git baseline `9823f41` on `dev`; `origin/dev` points to the same commit.
- At resume, confirmed there were no staged changes and that the uncommitted tree contained the completed Settings/Plugin convergence, Core-only Download and online-playback acceptance, Atom release identity/provenance, Core artifact work, and documentation updates later organized below.
- Created `8e08583` (`refactor: 收口 Core Settings 与 Plugin Control 边界`) from the real diff. Focused Settings/Plugin/Host-capability tests passed 34/34, Node/Web typecheck passed, touch budgets remained 105 / 22 / 13 / 14, and the staged diff passed `git diff --cached --check`.
- Created `98b71ef` (`test: 固化 Core 下载与在线续播策略`) with the Core-only Download contract, deterministic real-session acceptance harness, bounded source recovery, and Netease `fee=4` purchase classification. Focused Node tests passed 22/22, Web remained 84/84, Node/Web typecheck passed, and touch budgets remained 105 / 22 / 13 / 14.
- Created `191eefe` (`build: 建立 SPlayer Atom 独立发布身份`) with package/installer/updater/repository identity, stable/beta release channels, opt-in Orpheus compatibility ownership, third-party client naming, release CI guards, and the dedicated 14-file identity seam. Release-identity tests passed 7/7, release-assets tests passed 3/3, Node/Web typecheck passed, and all touch budgets remained exact.
- Created `4192f8f` (`build: 固化 Atom Core artifact 与发布溯源`) with `/api/info` release provenance, system/bundled artifact metadata and naming, packaged Node validation, About diagnostics, Core CI coverage, and deployment docs. Focused tests passed 39/39; both final tar variants were freshly generated, extracted, started, and passed Web/session/library/cache smoke on Node 24.18.0.
- Corrected `task_plan.md`, `findings.md`, `progress.md`, and `HANDOFF.md` against the actual local history. The four code checkpoints are local descendants of `9823f41`; `origin/dev` remains unchanged and no push was performed.
- The post-commit clean-tree gate passes Node 280/280, Web 84/84, Node/Web typecheck, ESLint, all files changed in `origin/dev..HEAD` through Prettier, touch audit 105 / 22 / 13 / 14, and commit-range whitespace checks. A broader `prettier --check .` also exposed 11 inherited formatting issues outside this change set; they were deliberately left untouched.

## 2026-08-30 — Hardware and live-provider acceptance entrypoints

- Created `f1614b8` (`test: 增加硬件与在线账号验收入口`) after verifying the actual staged diff. `origin/dev` remains at `9823f41`; no push was performed.
- Added `scripts/atom/check-hardware-release.ts` and `pnpm check:hardware-release`. Default execution sends only GET requests to the existing Core Control Protocol and emits structured, sanitized identity/output/status/session data plus optional artifact SHA256.
- State changes require explicit `--select-output`, `--play-pcm-index`, or `--play-dsd-index`. Device/format preflight rejects missing or mismatched targets before POST; the script never inserts/clears the queue, changes settings/database, reads credentials/logs, or retries an ambiguous failed output discovery.
- Added copyable real-hardware and live-provider checklists. They preserve manual DAC/bitstream and real-account evidence as external gates and forbid credentials, Authorization, cookies, final playable URLs, and unnecessary private paths in committed results.
- Full validation after the implementation commit passes Node 283/283, Web 84/84, Node/Web typecheck, ESLint, focused Prettier, `git diff --check`, and unchanged touch budgets 105 / 22 / 13 / 14.
