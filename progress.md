# SPlayer Atom — Current Progress

## 2026-08-29 — Historical records archived

- Removed obsolete claims about restricted devspace Git access.
- Archived the accumulated task plan, findings, progress log, and four dated handoff snapshots under local `history/`.
- Added `history/` to `.gitignore` so archived session material no longer affects repository status or future agent context.
- Recreated concise root `task_plan.md`, `findings.md`, and `progress.md` containing only current state and decisions.
- Updated the roadmap documentation map to distinguish current working files from ignored local history.

## Current Delivery State

- Core comments, library file operations, filesystem paths, Download authority, cache, deployment, migration safety, CI artifact generation, and Diretta SDK 149 provenance are implemented at their current checkpoints.
- Latest recorded full validation: Node 238/238, Web 65/65, Node/Web typecheck, ESLint, focused Prettier, `git diff --check`, touch audit 75 / 22 / 13, and Desktop production build with native rebuild skipped.
- Network proxy testing and audio-output reinitialization use real Core paths from Web; the Host no-op reachability audit is now closed. Web hides Desktop file-explorer actions, exports lyric posters through browser download, and no longer initializes Desktop updater/window/lyric subscriptions without the corresponding Host capability.
- Extended the shared `ControlAction` model from Track to Collection detail (playlist/album), Artist, and optional CoverList presentation. Collection/Artist primary+overflow actions and Favorites playlist/album/artist card unsubscribe derive from shared semantic actions while existing execution services remain authoritative; purely navigational cards intentionally stay click-only.
- Ownership-oriented checkpoint commits were pushed through `fd5671f`; hosted `Core System Gate` evidence remained green through `be96ad6` (run `33249130671`). The `02d761d` push was rejected before runner allocation because GitHub reported an account billing/spending-limit block across all hosted jobs; no workflow step executed, so this is tracked as external CI infrastructure rather than a code regression.
- A separate manual `Core Diretta Release Gate` now defines secure SDK-enabled release validation: controlled self-hosted Ubuntu 24.04 x86-64 runner, `diretta-sdk-149` label, SDK 149 pre-provisioned read-only outside the checkout, and existing `--require-diretta`/Release.hpp checks. The `diretta-release` Environment now exists with a `dev`-only deployment policy; only trusted runner registration remains before the first remote SDK-enabled run.
- Continued Desktop/Core transport convergence: Desktop `atom-core://control` and Headless Web now share one `buildCoreControlRoutes()` contract. In addition to playback/session/output and Managed Provider requests, active Library reads/search/random/scan-root/tag/file/avatar requests now use one `libraryClient`; Desktop directory/cover pickers remain explicit Host actions and scan progress remains event transport. Renderer-facing Direct stage/cancel/commit/materialize APIs and the dead renderer Direct preload state machine remain removed, leaving Direct ownership only in Core. Distributed player helpers and event transport remain follow-up slices.
