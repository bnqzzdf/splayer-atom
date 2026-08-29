# SPlayer Atom — Current Findings & Decisions

## Current Findings

- Comments, cache, download, filesystem browsing, and library file operations already had reusable Core-owned business seams; Web gaps were transport or Host-capability gaps, not reasons to create parallel domains.
- The combined §16 convergence baseline is Node 233/233, Web 59/59, Node/Web typecheck, ESLint, focused Prettier, `git diff --check`, touch audit 69 / 22 / 13, and a Desktop production build with native rebuild skipped.
- The ordinary and SDK-enabled Core artifact pipelines carry mutually consistent Diretta provenance. SDK-enabled artifacts record release 149; no-SDK artifacts record `diretta=false` and `direttaSdkRelease=null`.
- The first actual GitHub-hosted clean `Core System Gate` is complete: Actions run `33245921866` passed for commit `fd5671f` on 2026-08-29, including tests, typecheck, lint, touch audit, final Core artifact validation, deployment-surface checks and whitespace gate. After adding the Diretta release workflow, hosted run `33246384095` also passed for commit `6aac815`.
- Secure Diretta SDK provisioning is now an explicit release policy: a manual `Core Diretta Release Gate` runs only on a controlled self-hosted Ubuntu 24.04 x86-64 runner labeled `diretta-sdk-149`, with SDK 149 pre-provisioned read-only outside the checkout. The SDK is not stored in repository history, GitHub Secrets, Actions artifacts or release uploads. The `diretta-release` Environment exists with a `dev`-only deployment policy; the first remote SDK-enabled run is now blocked only on registering the trusted runner.
- Remote Qobuz/TIDAL acceptance still requires user-owned authentication. Physical DAC/front-panel bitstream confirmation remains a manual boundary.
- Network proxy configuration/testing and audio-output reinitialization are Core Domain behavior: Web now calls the same Core proxy test and `playerControl.reinitOutput()` path as Desktop rather than returning unsupported.
- The Netease embedded login BrowserWindow and installed-font enumeration are Control Host capabilities, not provider/Core auth behavior. The final Host-facade reachability audit also closed Web access to Desktop file explorer, host-save, updater/window initialization and desktop-lyric window subscriptions: Download file-location actions are hidden without `hostFileExplorer`, lyric-poster export uses `browserDownload`, and Desktop updater/window subscriptions are not initialized without their Host capabilities. Remaining no-op facade fields are compatibility shape rather than product capability.
- The shared `ControlAction` model remains evidence-driven and now covers Track; Collection (playlist/album/cloud/radio); Artist; and optional CoverList card presentation. Track right-click/row `...`, Collection/Artist primary+overflow actions, and Favorites cover-card unsubscribe all use the same semantic model/menu adapter while retaining the existing player/user/playlist execution paths; purely navigational cards remain click-only.
- Desktop's optional external API cannot be the internal Control transport because it is disabled by default and uses a different gated route set. The correct Desktop Core Protocol path is therefore the Electron-session-only `atom-core://control` Fetch scheme that dispatches directly to `buildHeadlessRoutes()` on the existing `persist:main` partition. Desktop now uses that shared protocol for play/pause/stop/seek, authoritative session/queue mutation, repeat/shuffle, Personal FM, auto-close, player processing/status, and output discovery/selection. Web-specific ALSA filtering and Diretta display naming are preserved in one Atom-owned Control projection, so protocol convergence does not turn presentation policy into Core policy. Distributed player helpers, Direct staging and event transport remain separate follow-up slices.

## Git Decision

- Devspace Git access is writable. The effective permission profile is full access, the repository metadata is writable, GitHub reports administrator access to `bnqzzdf/splayer-atom`, and local commit plus push dry-runs succeed.
- `origin` is the Atom repository and accepts `dev` pushes. The `splayer` remote is fetch-only by deliberate configuration.
- Future agents must treat Git write capability as available while still requiring explicit task authorization for external writes such as a real push.
- The current local convergence checkpoints are `12214ae` (Control Action Model), `223c18e` (Core release/migration chain), and `fb77991` (§16 Core/Control convergence).

## Documentation Decision

- Current execution state stays in `task_plan.md`, `findings.md`, and `progress.md`.
- Accumulated dated logs and handoff snapshots are local-only under `history/` and are ignored by Git so stale operational context cannot override the current roadmap.
- `docs/atom-roadmap.md` remains the authoritative source for unfinished work, priority, and acceptance criteria.
