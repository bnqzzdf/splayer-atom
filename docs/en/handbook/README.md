# SPlayer Atom Documentation Handbook

> Last updated: 2026-10-26
>
> Code baseline: `dev` branch commit `5693b3fc`, product version `1.1.3`
>
> Scope: the Node Core + Web Control deployment on Linux x86-64

This directory consolidates information scattered across the README, `docs/`, and the source into five formal deliverables. They address different audiences but share one set of code facts: product version, Core Protocol version, database schema, config schema, and port conventions all refer to the baseline above.

## Documents

| Document | Audience | Answers |
| --- | --- | --- |
| [Project Book](./01-project.md) | Project owners, architecture reviewers, acceptance | Why it exists, what it is, where the boundaries are, current completeness, risks |
| [Development Manual](./02-development.md) | Developers, reviewers | How to set up, how the code is organized, which layers a change touches, how to test and package |
| [Operations Manual](./03-operations.md) | Deployment and operations staff | Install, configure, upgrade, roll back, inspect, troubleshoot, harden |
| [User Guide](./04-user-guide.md) | End users | Library, playback, provider login, lyrics, downloads, plugins, stats |
| [API Reference](./05-api.md) | Integrators, frontend developers, automation authors | HTTP/WS contracts, data structures, units, error model, known compatibility issues |

## Reading paths

- **New to the project**: Project Book sections 1–6 → User Guide sections 2–5.
- **Preparing a deployment**: Operations Manual sections 2–7 → section 12 (upgrade/rollback) → section 14 (troubleshooting).
- **Preparing a code change**: Development Manual sections 2–6 → sections 8–10 (testing and engineering discipline) → the relevant module in the API Reference.
- **Integrating with Core**: API Reference sections 2–7 → section 8 (WebSocket) → section 10 (compatibility notes).
- **Release acceptance**: Project Book sections 13–14 → Operations Manual sections 14–17 → `docs/hardware-release-checklist.md`.

## Sources and conventions

These documents treat **actual code behavior** as the primary source, and existing prose documentation second.

1. Versions, schemas, ports, and defaults come from the repository; file paths or `file:line` references are given where useful.
2. "Implemented" means the code path and automated tests exist. "Acceptance pending" means a recorded run on real hardware, a real account, or target browsers is still required.
3. Known conflicts, stale documentation, and API defects are listed under "Known limitations" rather than hidden behind vague wording.
4. Units are stated at the Core/Web boundary: outward time fields are milliseconds, volume is `0..1`, speed is a multiplier, and auto-close duration is minutes.

## Relationship to existing documentation

This directory is a **delivery-level consolidation**; it does not replace the following topic documents:

- Installation and upgrades: `docs/en/core-deployment.md`
- GentooPlayer / OpenRC: `docs/en/gentooplayer-openrc.md`
- Build and packaging: `docs/en/build-and-packaging.md`, `docs/en/build-flavors.md`, `docs/cpu-variants.md`
- Plugin development: `docs/en/plugins/`
- Hardware acceptance: `docs/hardware-release-checklist.md` (Chinese only)
- Live provider acceptance: `docs/live-provider-acceptance.md` (Chinese only)
- Roadmap and completed work: `docs/en/atom-roadmap.md`, `docs/en/atom-completed.md`

If this directory conflicts with a topic document, the reproducible evidence in code and the topic document wins; this directory should be corrected.

## Revision history

| Date | Baseline | Change |
| --- | --- | --- |
| 2026-10-26 | `5693b3fc` / `1.1.3` | Initial five-document delivery |
