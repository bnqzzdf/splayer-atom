# SPlayer Atom — Current Progress

## 2026-08-29 — Historical records archived

- Removed obsolete claims about restricted devspace Git access.
- Archived the accumulated task plan, findings, progress log, and four dated handoff snapshots under local `history/`.
- Added `history/` to `.gitignore` so archived session material no longer affects repository status or future agent context.
- Recreated concise root `task_plan.md`, `findings.md`, and `progress.md` containing only current state and decisions.
- Updated the roadmap documentation map to distinguish current working files from ignored local history.

## Current Delivery State

- Core comments, library file operations, filesystem paths, Download authority, cache, deployment, migration safety, CI artifact generation, and Diretta SDK 149 provenance are implemented at their current checkpoints.
- Latest recorded full validation: Node 239/239, Web 66/66, Node/Web typecheck, ESLint, focused Prettier, `git diff --check`, touch audit 80 / 22 / 13, and Desktop production build with native rebuild skipped.
- Network proxy testing and audio-output reinitialization use real Core paths from Web; the Host no-op reachability audit is now closed. Web hides Desktop file-explorer actions, exports lyric posters through browser download, and no longer initializes Desktop updater/window/lyric subscriptions without the corresponding Host capability.
- Extended the shared `ControlAction` model from Track to Collection detail (playlist/album), Artist, and optional CoverList presentation. Collection/Artist primary+overflow actions and Favorites playlist/album/artist card unsubscribe derive from shared semantic actions while existing execution services remain authoritative; purely navigational cards intentionally stay click-only.
- Ownership-oriented checkpoint commits were pushed through `fd5671f`; hosted `Core System Gate` evidence remained green through `be96ad6` (run `33249130671`). Both `02d761d` and `a6df408` were rejected before runner allocation because GitHub reported the same account billing/spending-limit block; no workflow step executed, so this remains external CI infrastructure rather than a code regression.
- A separate manual `Core Diretta Release Gate` now defines secure SDK-enabled release validation: controlled self-hosted Ubuntu 24.04 x86-64 runner, `diretta-sdk-149` label, SDK 149 pre-provisioned read-only outside the checkout, and existing `--require-diretta`/Release.hpp checks. The `diretta-release` Environment now exists with a `dev`-only deployment policy; only trusted runner registration remains before the first remote SDK-enabled run.
- Continued Desktop/Core transport convergence: Desktop `atom-core://control` and Headless Web share one `buildCoreControlRoutes()` contract. Playback/session/output, Managed Provider, active Library requests, and distributed Player helper requests now use shared Core clients. FFT enable/read, local HD cover and external lyric reads no longer use Player IPC; remaining Player IPC is tray/thumbar Host presentation plus `onEvent` event transport. Desktop directory/cover pickers remain explicit Host actions and scan progress remains event transport. Renderer-facing Direct stage/cancel/commit/materialize APIs and the dead renderer Direct preload state machine remain removed, leaving Direct ownership only in Core.
