# Claude Code Guidance

Read `AGENTS.md` before changing the repository, then read the relevant sections of
`docs/atom-roadmap.md`.

SPlayer Atom ships only **Linux x86-64 Node Core + Web Control**. Electron/Desktop is not a product
surface and must not be reintroduced. Core owns all music-domain state; Web Control only sends
high-level commands and consumes Core HTTP/WS projections.

Use Chinese code comments and Conventional Commit titles with a one-line Chinese summary. Validate
changes proportionally using the commands and release rules in `AGENTS.md` and
`docs/atom-development.md`.
