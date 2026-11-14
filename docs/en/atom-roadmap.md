# SPlayer Atom Roadmap

> Last updated: 2026-11-14

## Current status

SPlayer Atom targets Linux x86-64 / aarch64 with a Core and Web Control product architecture.
Node is the default runtime; Bun remains an optional experimental flavor.

As of 2026-11-05, the maintainer marked **all 40 development, fix and acceptance items
as complete** in the latest Chinese roadmap. Those items have been moved to
[Completed Work](./history/atom-completed.md), grouped under ALSA/Diretta/UPnP,
providers/Web, folder browsing, and builds/releases. Historical work is no longer
presented as an active to-do list.

`1.3.0` was released on 2026-11-12 with SACD DST passthrough DFF (UPnP) and
x86/arm64 multi-architecture packages; `1.3.1` adds AudioSys installation and a web-menu card; `1.3.2` fixes WAV Chinese tag corruption.
See [SACD DST-DFF](../history/sacd-dst-dff.md) (Chinese only),
[multi-architecture build and installation](./multiarch-build.md), and the
[AudioSys menu plan](../history/audiosys-menu-1.3.1.md) and
[WAV tag corruption fix](../history/wav-gbk-tags-1.3.2.md) (both Chinese only) for scope and acceptance boundaries.

A maintainer-confirmed completion status is distinct from independently reviewable
acceptance evidence. Some newly checked hardware, real-account, browser, endurance
and final-release acceptance items have no matching new report in the repository.
This documentation update does not rerun tests or use an old artifact's measurements
as evidence for `1.3.2`. Original test results and their applicable commits, devices
and artifacts remain documented in the [history archive](./history/README.md).

## Subsequent development tasks

**No further development tasks at present.**

No feature development, fixes or acceptance work are currently scheduled on this
roadmap. Record new requirements or defects as new scoped tasks rather than
automatically reopening completed historical plans.

## Version and release

- The current source product version is `2026.11.14` (migrated to `YYYY.M.D` date-based versioning, incrementing `-1`/`-2` for same-day releases).
- The latest published release is `v1.3.2` (with x86-64 and aarch64 multi-architecture packages on GitHub Releases); `2026.11.14` has not been tagged yet.
- Release assets: `linux-x86_64-multi` (v1/v2/v3/v4/zen4) and
  `linux-aarch64-multi` (arm64).
- See [build flavors](./build-flavors.md) and the
  [runtime comparison](../history/bun-runtime-experiment.md) (Chinese only)
  for Node/Bun variants, past builds and scoped benchmarks.

## Product scope and constraints

The current product targets a single user on a trusted home/LAN network.
Authentication, pairing, TLS and stricter browser-origin controls require
a new accepted product requirement if pursued; they are not outstanding tasks
from this roadmap. Follow `AGENTS.md` for lasting constraints and the
[development guide](./atom-development.md) for workflows.

## Related documents

| Document                                                                                                    | Purpose                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Completed Work](./history/atom-completed.md)                                                               | Closeout status for all 40 items, implementation and historical acceptance boundaries |
| [History archive](./history/README.md)                                                                      | Past plans, device checks and scoped results                                          |
| [Development guide](./atom-development.md)                                                                  | Environment, checks and development conventions                                       |
| [Build and packaging](./build-and-packaging.md), [build flavors](./build-flavors.md)                        | Core/Web artifacts and Node/Bun flavors                                               |
| [Multi-architecture build and installation](./multiarch-build.md)                                           | x86 v1/v2/v3/v4/zen4 + arm64 packages and installer                                   |
| [Core deployment](./core-deployment.md)                                                                     | systemd, install, upgrade and rollback                                                |
| [Hardware checklist](./hardware-release-checklist.md), [provider acceptance](./live-provider-acceptance.md) | Acceptance criteria and existing historical evidence                                  |
