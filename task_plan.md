# SPlayer Atom — Current Development Plan

## Goal

Maintain SPlayer Atom as a minimal downstream of SPlayer-Next. Keep Node Core authoritative,
Desktop/Web as Controls, and Diretta strictly Source Direct.

## Current Phase

Repository cleanup after the software release-boundary freeze. Remaining product release blockers
are real accounts, a controlled Diretta SDK runner, and genuine ALSA/Diretta hardware evidence.

## Git Ground Truth

- Cleanup started from clean `90a5bcc` on `dev`; `origin/dev` was `9823f41` and local `dev` was ahead
  by seven commits.
- No push is authorized or performed.
- Historical commit/run descriptions are advisory only; always re-read `git log/status/diff`.

## Active Work

- [x] Inventory tracked, untracked, ignored, generated, cached, and historical files.
- [x] Move the completed root handoff to `history/handoffs/`; keep no tracked `HANDOFF.md`.
- [x] Archive obsolete agent guidance and replace only active integration entrypoints with concise
      pointers to `AGENTS.md` and `docs/atom-roadmap.md`.
- [x] Archive unreferenced migration analysis and resolved investigation notes; remove `demo/`.
- [x] Move package/build/Rust/native/tool caches into dated `history/generated/` categories.
- [x] Preserve `node_modules/` as the active ignored pnpm installation, not historical content.
- [x] Snapshot and compact root planning memory while keeping `task_plan.md`, `findings.md`, and
      `progress.md` as required current-state files.
- [x] Validate references, formatting, Node 283/283, Web 84/84, Node/Web typecheck, no-cache ESLint,
      touch budgets 105 / 22 / 13 / 14, and the final Git diff.
- [x] Stage the exact cleanup diff and verify it as one ownership-coherent commit. The commit
      containing this planning line is the cleanup checkpoint; read its actual hash from `git log`.

## Retained Repository Material

- `docs/atom-roadmap.md` remains authoritative for scope/status; operational docs remain current.
- `compat/legacy-http-contracts.json` remains because `report-http-contracts.mjs` consumes it.
- `auto-eslint.mjs`, `dev-app-update.yml`, generated declaration files, and lockfiles remain because
  current build/type/test tooling consumes or validates them.
- Upstream-owned user documentation stays tracked; stale content should be updated through the
  normal upstream/minimal-delta process rather than bulk-archived during cleanup.

## Pending External Gates

- Netease/Qobuz/TIDAL real-account acceptance.
- Real ALSA PCM/Native DSD and Diretta Target playback, switching, auto-next, and long-play.
- Controlled `self-hosted, linux, x64, diretta-sdk-149` runner and first remote required-SDK gate.

## Errors Encountered

| Error                                                       | Attempt | Resolution                                                                                        |
| ----------------------------------------------------------- | ------: | ------------------------------------------------------------------------------------------------- |
| `git log --follow` was called with multiple candidate paths |       1 | Switched to one history query per file; the failed command was read-only and changed nothing.     |
| A residual-reference `rg` shell pattern contained backticks |       1 | The accidental command substitution changed no files; future searches use single-quoted patterns. |
| Touch audit classified five upstream docs as business code  |       1 | Added the exact guidance/demo paths to the existing downstream-metadata classification.           |
| A combined patch used the pre-Prettier table spacing        |       1 | Split the audit and plan edits, then patched the exact formatted blocks.                          |
