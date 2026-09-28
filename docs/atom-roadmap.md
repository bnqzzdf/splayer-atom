# SPlayer Atom Roadmap

## Current status

Last reviewed against source: 2026-09-28 (`188fcfbc`). This date is a documentation/code review,
not a new hardware, account, browser or release acceptance run.

SPlayer Atom is a Linux x86-64 Node Core with Web Control as its only UI. The Web + Core migration,
ALSA HW Direct / Processed paths, Diretta Source Direct, UPnP output, Core-owned Folder Browser,
Direct CUE gapless path, responsive Web layout and lyric P0/P1 implementation are in the current
tree. Core/Web paths for Netease, QQ Music, Kugou, Qobuz and TIDAL are present. Debian 11
bundled packages can be built with or without Diretta. Confirmed implementation milestones are in
[Atom Completed](./atom-completed.md).

Folder Browser's existing implementation includes paged browsing, pinned folders, physical-name
search, current-directory filtering, list/grid views, materials, scoped scanning, recursive actions
and batch actions for loaded media/container tracks. List/grid preference persistence is also
implemented (`058c0e63`); it is not pending development. The first improvement stage
(`b54265b6`) implements Core-side filename, modification-time and disc/track display sorting,
physical browse attributes and sort-aware cursor invalidation. The second stage (`a9e175a3`)
adds Web sorting controls, browser-local default persistence, sort-aware route/history state,
filter/scroll restoration and containing-folder focus. The third stage now adds physical filename
and compact file/track information, explicit recursive/current-folder scope feedback, loaded-item
batch-selection wording and Folder Search truncation feedback (`188fcfbc`). First-batch
implementation is now complete; plan-level acceptance remains pending.

This roadmap tracks remaining work and acceptance. Code establishes whether a path exists;
hardware, real-account, browser and release acceptance require a recorded run. The
[2026-09-22 ALSA record](./alsa-acceptance-2026-09-22.md) covers artifact commit `cecee166`;
the [2026-09-23 FC4 retest](./alsa-acceptance-2026-09-23.md) covers the two fixes in installed
artifact commit `3e420f78`. A later [local-module ALSA retest](./alsa-gap-fixes-2026-09-23.md)
covers source changes through `53284360`; it is not an installed Core artifact. The no-hardware-pause
fallback branch is retained for devices that need it and has software verification only.
Identify each new artifact by its recorded Git commit, not by the package version alone.

Lasting constraints are in `AGENTS.md`; workflows are in the
[development guide](./atom-development.md).

## Open work and acceptance

### ALSA and output

- [ ] Validate the [ALSA output plan](./alsa-output-plan.md) changes in a clean candidate Core
      artifact. The [FC4 local-module retest](./alsa-gap-fixes-2026-09-23.md) passed short
      Processed pitch/speed playback, pitch/speed seek and Direct basic playback. Check the
      supported modes, formats, transitions and resource trend on that candidate; investigate
      a specific failure if observed. Shared `AlsaFrameWriter`, single runtime ownership and
      bounded decoded/DSP queues are implemented. Separate mode control loops, parameter-version
      tracking and an arbitrary cap on one upstream decoder frame are not acceptance gates.
- [ ] Complete target-device ALSA format and lifecycle checks on the clean candidate. Independent
      PCM/DSD comparisons already establish exact data at the USB submission layer. Final DAC
      bit-test or digital capture is needed only for a device-specific end-to-end claim; the
      product's software guarantee ends at the ALSA HW submission boundary. A device without
      hardware pause is needed only to claim its fallback path has been verified on that device.
- [ ] Repeat UPnP hardware checks on the release candidate. The 2026-09-22 FC4 run discovered no
      renderer; earlier AudioSys checks covered common formats, CUE, SACD, DSD and output switching.
      The media listener passed 100 repeated aborted pulls on 2026-09-23, but no AudioSys Renderer
      is currently available. Finish the second real-renderer long-run resource check in the
      [UPnP plan](./upnp-output-plan.md) and record the final compatibility matrix.
- [ ] Complete real Diretta CUE gapless acceptance in the
      [Direct CUE plan](./direct-cue-gapless-plan.md), including adjacent PCM/DSD segments, seek,
      queue changes and long-running boundary behavior.

### Providers and Web Control

- [ ] Record full real-account acceptance against [provider criteria](./live-provider-acceptance.md)
      for Netease, QM, KG, Qobuz and TIDAL on the intended artifact. The QM/KG product paths and
      Qobuz browser OAuth/token-only login are implemented but have no real-account acceptance run
      for this tree. Existing UPnP notes verify selected real Netease/TIDAL online paths, not
      complete provider matrices.
- [ ] Add a bounded real-token ListenBrainz acceptance record for Now Playing, permanent listens,
      401/429 handling, offline retry and restart. The current code implements these paths, but
      the former completion checkbox had no corresponding run record in the repository.
- [ ] Complete responsive Web Control acceptance at the representative viewports and actual mobile
      devices in the [responsive plan](./web-responsive-plan.md). The layout is implemented; no
      complete device/interaction acceptance record is in the repository.
- [ ] Record long-running use with multiple real Web Controls across refresh, disconnect and
      reconnect. The artifact smoke passed multiple WebSocket clients and reconnection; that is
      narrower than long-running browser acceptance.

### Folder Browser

The [original plan](./local-folder-browser-plan.md) defines the implemented foundation;
the [improvement plan](./folder-browser-improvements.md) defines the next development work.
Display order remains separate from Core-owned directory playback order.

- [x] Implement first-batch Core display sorting: filename, modification time and disc/track
      order, with ascending/descending direction, fixed entry groups, lightweight physical
      attributes, sorting before pagination and cursor invalidation for changed results.
- [x] Implement first-batch Web sorting controls and browser-local preference persistence;
      integrate sort-aware history, filter/scroll restoration and exact containing-folder focus.
      Reuse the existing list/grid persistence rather than implementing it again.
- [x] Complete first-batch information and scope feedback: physical filenames and necessary
      track/file fields, explicit recursive/current-directory playback scope, loaded-item batch
      selection wording and the existing Core search-truncation signal.
- [ ] Verify the first batch against the improvement plan's automated and manual criteria.
      Record implementation completion separately from real-library/browser acceptance.
- [ ] Complete manual browser, NAS/USB, large-directory and material-viewer acceptance for the
      existing Core-owned Folder Browser (original plan sections 17/18), combining the run with
      first-batch checks where practical. Core/Web implementation and automated coverage exist;
      the old full-tree projection is removed. No complete real-library acceptance record exists.
- [ ] Follow up with the second batch: canonical album/artist/detail navigation, current-subtree
      recursive search and actionable batch failure details. Additional metadata sorting follows
      concrete use cases; second-batch work does not block first-batch acceptance.

### Release

- [ ] Build a clean artifact from the intended Git commit and complete the
      [hardware checklist](./hardware-release-checklist.md) and
      [deployment checklist](./core-deployment.md) on that same candidate, including install,
      upgrade and rollback. The `cecee166` archive passed file comparison and extracted-artifact
      smoke, but its observed seek/restart failures prevent closing final acceptance. Debian 11
      bundled builds without Diretta and with SDK 150 Diretta v3 passed build/artifact smoke on
      2026-09-23 from a dirty working tree; they are not clean release candidates or hardware
      acceptance. v2/v4 remain selectable but have not been built in this record.
- [ ] After those gates pass, prepare the stable release with artifact commit, hash, capabilities
      and acceptance results recorded.

## Current priorities

1. Validate ALSA behavior and resource trend using one clean candidate artifact; fix observed failures.
2. Complete the target-device ALSA checks and outstanding UPnP/Diretta CUE hardware acceptance.
3. Implement the first batch of Folder Browser improvements: Core sorting/pagination, Web
   navigation state, necessary file information and operation-scope feedback. Reuse the implemented
   Folder Browser foundation; keep the second batch separate.
4. Complete all five provider matrices, ListenBrainz, Folder Browser (existing features plus the
   first batch), responsive Web and long-running multi-Control acceptance.
5. Run install, upgrade, rollback and final hardware checks on one clean candidate, then release.

## Product scope

The current release targets one user on a trusted home/LAN network. Authentication, pairing, TLS
and stricter browser-origin controls require a later accepted product requirement.

## Related documents

| Document                                                                                           | Purpose                                                          |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Atom Completed](./atom-completed.md)                                                              | Confirmed implementation and bounded acceptance history          |
| [Development guide](./atom-development.md)                                                         | Environment, checks and conventions                              |
| [Build and packaging](./build-and-packaging.md), [build flavors](./build-flavors.md)               | Core/Web artifacts and variants                                  |
| [Core deployment](./core-deployment.md)                                                            | systemd, durable data, install, upgrade and rollback             |
| [Hardware checklist](./hardware-release-checklist.md)                                              | ALSA, Diretta and UPnP release checks                            |
| [Provider acceptance](./live-provider-acceptance.md)                                               | Real-account criteria                                            |
| [ALSA plan](./alsa-output-plan.md), [UPnP plan](./upnp-output-plan.md)                             | Output implementation and remaining checks                       |
| [Folder Browser plan](./local-folder-browser-plan.md), [responsive plan](./web-responsive-plan.md) | Web feature and device criteria                                  |
| [Folder Browser improvements](./folder-browser-improvements.md)                                    | Sorting, file information, operation scope and staged acceptance |
| [Direct CUE plan](./direct-cue-gapless-plan.md), [lyric plan](./lyric-improvements.md)             | Gapless and lyric implementation                                 |
