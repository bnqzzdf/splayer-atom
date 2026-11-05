# Historical documentation

> Last updated: 2026-11-05

> Organized: 2026-11-05

This directory preserves completed implementation plans, experimental measurements, and test records tied to specific commits or devices. **Archiving does not imply that all hardware, account, browser, or release acceptance gates have passed.**

For current requirements and practices, see [AGENTS.md](https://github.com/bnqzzdf/splayer-atom/blob/dev/AGENTS.md) and the [development guide](../atom-development.md). The [roadmap](../atom-roadmap.md) and [hardware release checklist](../hardware-release-checklist.md) remain authoritative for pending work.

## Implementations and plans

- [Completed work](./atom-completed.md): implementation milestones and bounded evidence.
- [Folder Browser plan](./local-folder-browser-plan.md) and [first-batch improvements](./folder-browser-improvements.md).
- [Responsive Web layout](./web-responsive-plan.md) and [lyric improvements](./lyric-improvements.md).
- [Qobuz OAuth plan](./qobuz-oauth-plan.md).
- [Upstream UI and fix plan](../../history/upstream-ui-adoption-plan.md) (Chinese only).

## Audio output and acceptance records

- [ALSA output](./alsa-output-plan.md), [UPnP output](./upnp-output-plan.md), and [Direct CUE gapless playback](./direct-cue-gapless-plan.md) plans.
- [2026-09-22 ALSA acceptance](./alsa-acceptance-2026-09-22.md) and [2026-09-23 installed-artifact retest](./alsa-acceptance-2026-09-23.md).
- [2026-09-23 local native fixes](./alsa-gap-fixes-2026-09-23.md) and [runtime smoke](./alsa-runtime-smoke-2026-09-23.md).

## Builds and experiments

- [Node/Bun runtime comparison](../../history/bun-runtime-experiment.md) (Chinese only). For current packaging use [build flavors](../build-flavors.md).
- [Debian 11 historical build compatibility](./debian11-build-compatibility.md).

See also the [Chinese archive](../../history/README.md).
