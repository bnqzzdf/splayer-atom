# SPlayer Atom — Current Progress

## Delivery State

- Software release identity, Core-owned playback, Core Control Protocol, system/bundled Core
  artifacts, deployment/rollback, provider surfaces, and hardware/live acceptance tooling are
  complete at their software-verifiable checkpoints.
- Latest pre-cleanup validation baseline: Node 283/283, Web 84/84, Node/Web typecheck, ESLint,
  current-change-set Prettier, `git diff --check`, and touch budgets 105 / 22 / 13 / 14.
- Clean system/bundled artifacts were last rebuilt at `f768c97`; a formal candidate must still be
  rebuilt from its final selected clean commit.

## 2026-08-30 — Repository Cleanup

- Audited the repository from actual Git tracking/ignore state at `90a5bcc`.
- Archived the completed root handoff; removed `HANDOFF.md` from the tracked tree.
- Archived obsolete Claude/Copilot/review guidance and replaced the three tracked integration files
  with compact, current `AGENTS.md`/Roadmap-based instructions.
- Archived two unreferenced `demo/` documents by purpose and removed the empty directory.
- Archived ignored build/package/Rust/native/tool outputs into dated history categories without
  deleting them. Preserved the active ignored pnpm dependency installation.
- Snapshotted the previous planning files under `history/planning/pre-cleanup-2026-08-30/` and
  replaced root planning memory with concise current state.
- Corrected the stale Roadmap §5 introduction to match its completed Core-owned playback evidence.
- Validation passes from the cleaned active tree: Node 283/283, Web 84/84, Node/Web typecheck,
  no-cache ESLint, changed-file Prettier, `git diff --check`, and touch budgets 105 / 22 / 13 / 14.
  Test-created Vite caches were moved back into the dated tool-cache archive.
- Cleanup is packaged as one ownership-coherent checkpoint. Its actual hash is intentionally read
  from `git log` rather than self-recorded inside the commit.

## Git State

- `origin/dev` remains at `9823f41`; local cleanup started seven commits ahead at `90a5bcc`.
- No push has been performed or authorized.
