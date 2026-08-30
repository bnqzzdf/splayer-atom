# SPlayer Atom — Current Findings & Decisions

## Cleanup Findings

- `HANDOFF.md` was the only tracked handoff. It is complete and now lives locally at
  `history/handoffs/handoff-2026-08-30.md`; earlier handoffs were already categorized there.
- The old `CLAUDE.md` and Copilot/review instructions described the pre-Core SPlayer-Next
  renderer/Player-IPC architecture and contained listener guidance that conflicted with `AGENTS.md`.
  Their complete old versions are archived under `history/obsolete-guidance/`; concise tracked
  entrypoints now defer to `AGENTS.md` and the Roadmap rather than freezing another inventory.
- `demo/audio-architecture.md` was an unreferenced AMLL migration proposal.
  `demo/desktop-lyric-drag.md` was a resolved DPI investigation whose cached-size solution is already
  implemented. They are archived under `history/reference-analysis/` and
  `history/resolved-investigations/`.
- Generated/local output moved into `history/generated/2026-08-30/`: `dist/` (~867 MiB), `out/`
  (~305 MiB), `target/` (~14 GiB), four native addons, `.eslintcache`, and Vite caches.
- `node_modules/` (~874 MiB after cache removal) remains active. It is ignored, reproducible from the
  lockfile, and required to validate the cleaned checkout; moving it would not improve repository
  submission hygiene.
- After generated output moved, `git clean -ndX` lists only intentional `history/` and
  `node_modules/` trees.
- The touch audit now classifies the three agent-guidance files and two removed demo documents as
  downstream metadata. This keeps the business/runtime/Core/release budgets at 105 / 22 / 13 / 14
  while reporting all nine metadata touches explicitly rather than hiding them as code.

## Current Authority

- `AGENTS.md` owns durable implementation rules. `docs/atom-roadmap.md` owns scope, priority,
  completion state, and acceptance criteria.
- Node Core owns database/settings/library/provider session/queue/playback policy/source/cache/
  preload/statistics/output assignment. Desktop/Web share the Core Control Protocol; Electron IPC is
  for Host capabilities.
- Diretta remains strict Source Direct. Software tests cannot close real DAC/bitstream acceptance.
- Root `task_plan.md`, `findings.md`, and `progress.md` remain current working state; complete earlier
  versions are locally archived under `history/planning/`.

## Retention Decisions

- Keep `compat/legacy-http-contracts.json`: active report tooling consumes it as a retained protocol
  oracle.
- Keep `auto-eslint.mjs` and generated declarations: current Vite/ESLint/type tooling consumes them.
- Keep `dev-app-update.yml`: release identity tests validate it.
- Keep upstream-owned product docs and compatibility code unless a concrete Atom delta requires an
  update; unreferenced history is not a reason for broad upstream deletion.

## Remaining External Work

- Live Netease/Qobuz/TIDAL acceptance needs user-authorized accounts and entitlement evidence.
- Hardware release acceptance needs real ALSA/Diretta/PCM/Native-DSD/long-run evidence.
- The Diretta SDK 149 remote gate needs the controlled self-hosted runner.
