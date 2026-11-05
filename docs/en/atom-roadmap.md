# SPlayer Atom Roadmap

> Last updated: 2026-11-05

## Current status

SPlayer Atom targets Linux x86-64 with a Core and Web Control product architecture.
Node is the default runtime; Bun remains an optional experimental flavor.

As of 2026-11-05, the maintainer marked **all 40 development, fix and acceptance items
as complete** in the latest Chinese roadmap. Those items have been moved to
[Completed Work](./history/atom-completed.md), grouped under ALSA/Diretta/UPnP,
providers/Web, folder browsing, and builds/releases. Historical work is no longer
presented as an active to-do list.

A maintainer-confirmed completion status is distinct from independently reviewable
acceptance evidence. Some newly checked hardware, real-account, browser, endurance
and final-release acceptance items have no matching new report in the repository.
This documentation update does not rerun tests or use an old artifact's measurements
as evidence for v1.2.0. Original test results and their applicable commits, devices
and artifacts remain documented in the [history archive](./history/README.md).

## Subsequent development tasks

**No further development tasks at present.**

No feature development, fixes or acceptance work are currently scheduled on this
roadmap. Record new requirements or defects as new scoped tasks rather than
automatically reopening completed historical plans.

## Version and release

- The current source product version is `1.2.0`.
- The `dev` branch includes commit `5b8773c3`, and Git tag `v1.2.0`
  has been pushed to GitHub.
- A Git tag is not a GitHub Release. Whether a Release and downloadable
  artifacts exist depends on the actual GitHub release record.
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

| Document | Purpose |
| --- | --- |
| [Completed Work](./history/atom-completed.md) | Closeout status for all 40 items, implementation and historical acceptance boundaries |
| [History archive](./history/README.md) | Past plans, device checks and scoped results |
| [Development guide](./atom-development.md) | Environment, checks and development conventions |
| [Build and packaging](./build-and-packaging.md), [build flavors](./build-flavors.md) | Core/Web artifacts and Node/Bun flavors |
| [Core deployment](./core-deployment.md) | systemd, install, upgrade and rollback |
| [Hardware checklist](./hardware-release-checklist.md), [provider acceptance](./live-provider-acceptance.md) | Acceptance criteria and existing historical evidence |
