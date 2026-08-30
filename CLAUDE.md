# Claude Code Guidance

Before changing this repository, read `AGENTS.md` completely, then read the relevant sections of
`docs/atom-roadmap.md`. `AGENTS.md` owns durable implementation rules; the Roadmap owns product
scope, priorities, completion state, and acceptance criteria. Stop and ask the user if they
materially conflict.

Do not treat this file as a second architecture inventory. The current model is Core / Control /
Output: Node Core owns music-domain authority, Desktop and Web share the Core Control Protocol,
and Electron IPC remains for Host capabilities. SPlayer owns the foundation; Atom adds only proven
Headless Web, Qobuz, TIDAL, and strict Diretta Source Direct deltas.

Use the repository's current planning files for working state:

- `task_plan.md`
- `findings.md`
- `progress.md`

Use Chinese code comments and Conventional Commit titles with a one-line Chinese summary. Validate
changes proportionally using the commands and platform rules in `AGENTS.md` and
`docs/atom-development.md`.
