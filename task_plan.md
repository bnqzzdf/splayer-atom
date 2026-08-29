# SPlayer Atom — Current Development Plan

## Goal

Build SPlayer Atom as a continuously updated downstream of SPlayer-Next. Reuse upstream capabilities wherever possible and keep Atom-specific behavior limited to the smallest proven delta.

## Current Phase

Roadmap P3 — Core release gates plus §16 capability-driven Control convergence.

## Current Baseline

- P0 upstream sync, Core-owned playback, Node Core runtime/artifacts, Core Protocol v1, provider-session projection, durable schema migration/backup, and deployment/upgrade/rollback are software-complete at their current checkpoints.
- The latest validated repository baseline is Node 238/238, Web 65/65, Node/Web typecheck, ESLint, focused Prettier, `git diff --check`, touch audit at 75 business / 22 runtime-neutral / 13 Core-authority, and a Desktop production build with native rebuild skipped.
- Core comments, filesystem paths, library file operations, cache, Download, network-proxy testing, and audio-output reinitialization are projected through existing Core services/commands rather than parallel Web-owned implementations.
- The shared `ControlAction` model now covers Track, Collection detail (playlist/album), Artist, and optional CoverList card presentation. Track right-click/row `...`, Collection/Artist primary+overflow actions, and Favorites card unsubscribe all consume shared semantic lists; provider execution stays in existing stores/services.
- Diretta Source Direct remains bound by the source-rate/channel/sample/DSD-sequence invariants in `AGENTS.md`; SDK release provenance is pinned to Diretta SDK 149 for the first Linux x86-64 Core release.

## Active Work

- [x] Keep Action Model UX evidence-driven: Track, Collection/Artist detail, and Favorites playlist/album/artist cover cards now expose shared semantic actions where real secondary actions exist; purely navigational CoverList callers remain click-only rather than inventing meaningless menus.
- [x] Classify the audited ambiguous surfaces: network proxy and audio-output reinitialization are Core Domain; the Electron provider-login window and system-font enumeration are Control Host capabilities.
- [x] Finish the no-op Host-surface reachability audit: Web no longer reaches Desktop updater/window/lyric initialization, file-explorer actions are capability-hidden, and lyric poster export uses browser download rather than Desktop host save. Remaining no-op fields are compatibility shape or frozen unsupported provider surface, not exposed product capability.
- [x] Split the validated working tree into ownership-coherent Conventional Commits: `12214ae` (Control Action Model), `223c18e` (Core release/migration chain), and `fb77991` (§16 Core/Control convergence); this documentation cleanup is the final local-clean checkpoint.
- [x] Push the reviewed `dev` commits to `origin` and obtain the first GitHub-hosted clean `Core System Gate` result; run `33245921866` passed for commit `fd5671f` on 2026-08-29.
- [~] Secure Diretta SDK CI provisioning is defined as a manual `Core Diretta Release Gate`; the `diretta-release` Environment exists with a `dev`-only deployment policy, and ordinary hosted Core gates remained green through `be96ad6` (run `33249130671`). The later `02d761d` push could not start any GitHub-hosted runner because GitHub reported a billing/spending-limit account block; this is external CI infrastructure, not a code failure. Registering a trusted self-hosted `diretta-sdk-149` runner with SDK 149 pre-provisioned outside the checkout, then executing the first remote SDK-enabled gate, remain pending.
- [~] Continue §16 Desktop/Core transport convergence. Desktop renderer play/pause/stop/seek, authoritative session/queue/repeat/shuffle/Personal-FM/auto-close, player processing/status, output discovery/selection, Atom-managed Provider requests, and active Library requests now use the same Core Protocol paths as Web. Desktop `atom-core://control` and Headless Web share one `buildCoreControlRoutes()` router composed from existing Headless + thin compat routes; Library reads/search/random/scan roots/tags/files/artist avatars use one `libraryClient`, while `pickScanDir` / `pickCoverImage` remain Host actions and scan progress remains event transport. QQ/酷狗 legacy `call` stays frozen IPC, embedded Netease login stays Host-only, and provider session push remains event transport. Renderer-facing Direct stage/cancel/commit/materialize APIs and the dead renderer Direct preload state machine are removed, leaving Direct input/staging/boundary authority only in Core. Remaining Electron IPC must be classified as true Host capability or migrated incrementally; distributed player helpers and event transport are the next candidates, while Desktop shell / Host Capability stays on IPC.
- [ ] Complete live-account Qobuz/TIDAL and genuinely manual DAC/bitstream acceptance when user-owned credentials and hardware confirmation are available.

## Git Access

- The workspace, `.git`, and `.git/index` are writable.
- `origin` is `https://github.com/bnqzzdf/splayer-atom.git`; the authenticated GitHub account has administrator access.
- Local staging/commit dry-runs and `git push --dry-run origin dev` were verified successfully on 2026-08-29.
- The `splayer` upstream remote intentionally has push disabled to prevent accidental upstream writes.

## Architecture Guardrails

- Default to no Atom abstraction until current upstream proves one is needed.
- Prefer upstream types, stores, services, registries, plugin APIs, persistence, and native interfaces over Atom-owned mirrors.
- Headless and Web must reuse the authoritative SPlayer runtime state rather than define parallel player, queue, library, settings, or media state.
- Zones remain deferred until a concrete requirement cannot be represented by upstream state.
- Diretta must bypass sample-altering upstream processing wherever required to guarantee Source Direct.
- Widespread edits across upstream Home/Search/Queue/Player/Settings are a stop-and-redesign signal.

## Errors Encountered

| Error                                              | Attempt | Resolution                                                                                       |
| -------------------------------------------------- | ------: | ------------------------------------------------------------------------------------------------ |
| The first archive move used stale handoff headings |       1 | The atomic patch made no changes; the exact headings were read and the corrected move succeeded. |
