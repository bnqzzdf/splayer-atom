# SPlayer Atom Roadmap

## Current status

SPlayer Atom is a Linux x86-64 Node Core with Web Control as its only UI. The Web + Core migration,
ALSA HW Direct / Processed paths, Diretta Source Direct, UPnP output, Core-owned Folder Browser,
Direct CUE gapless path, responsive Web layout and lyric P0/P1 implementation are in the current
tree. Confirmed milestones are in [Atom Completed](./atom-completed.md).

This roadmap tracks remaining work and acceptance. Code establishes whether a path exists;
hardware, real-account, browser and release acceptance require a recorded run. The
[2026-09-22 ALSA record](./alsa-acceptance-2026-09-22.md) covers artifact commit `cecee166`;
fixes in later commits are not retroactively covered. Identify each new artifact by its recorded
Git commit, not by the package version alone.

Lasting constraints are in `AGENTS.md`; workflows are in the
[development guide](./atom-development.md).

## Open work and acceptance

### ALSA and output

- [ ] Retest Processed PCM seek and restart-to-play on FC4 with an artifact containing `c3e135ab`.
      That commit fixes writer cancellation reported as `outputFailed` and reloads the restored
      queue when `play()` sees an idle native runtime. Both failures were reproduced on
      `cecee166`; no later real-device result is recorded.
- [ ] Finish the [ALSA output plan](./alsa-output-plan.md) runtime/buffering work. Direct and
      Processed still have separate native lifecycle orchestration; Processed final gain, limiting,
      packing and buffer resizing still occur in the writer.
- [ ] Obtain final-device ALSA bit-test or digital-capture evidence and complete the remaining
      device/format matrix. Existing PCM/DSD USB submission comparisons establish byte equality
      at that layer, not the DAC's final digital output.
- [ ] Repeat UPnP hardware checks on the release candidate. The 2026-09-22 FC4 run discovered no
      renderer; earlier AudioSys checks covered common formats, CUE, SACD, DSD and output switching.
      Finish the second long-run resource check in the [UPnP plan](./upnp-output-plan.md) and
      record the final compatibility matrix.
- [ ] Complete real Diretta CUE gapless acceptance in the
      [Direct CUE plan](./direct-cue-gapless-plan.md), including adjacent PCM/DSD segments, seek,
      queue changes and long-running boundary behavior.

### Providers and Web Control

- [ ] Complete Qobuz real-account login/search/queue/playback/logout acceptance.
- [ ] Record full real-account acceptance against [provider criteria](./live-provider-acceptance.md)
      for Netease and TIDAL on the intended artifact. Existing UPnP notes verify selected real
      Netease/TIDAL online paths; they do not document the complete provider matrices.
- [ ] Add a bounded real-token ListenBrainz acceptance record for Now Playing, permanent listens,
      401/429 handling, offline retry and restart. The current code implements these paths, but
      the former completion checkbox had no corresponding run record in the repository.
- [ ] Complete manual browser, NAS/USB, large-directory and material-viewer acceptance for the
      merged [Core-owned Folder Browser](./local-folder-browser-plan.md). Its Core/Web implementation
      and automated tests are present; the old full-tree projection has been removed.
- [ ] Complete responsive Web Control acceptance at the representative viewports and actual mobile
      devices in the [responsive plan](./web-responsive-plan.md). The layout is implemented; no
      complete device/interaction acceptance record is in the repository.
- [ ] Record long-running use with multiple real Web Controls across refresh, disconnect and
      reconnect. The artifact smoke passed multiple WebSocket clients and reconnection; that is
      narrower than long-running browser acceptance.

### Release

- [ ] Build a clean artifact from the intended Git commit and complete the
      [hardware checklist](./hardware-release-checklist.md) and
      [deployment checklist](./core-deployment.md) on that same candidate, including install,
      upgrade and rollback. The `cecee166` archive passed file comparison and extracted-artifact
      smoke, but its observed seek/restart failures prevent closing final acceptance.
- [ ] After those gates pass, prepare the stable release with artifact commit, hash, capabilities
      and acceptance results recorded.

## Current priorities

1. Retest the two ALSA fixes on hardware and finish the remaining ALSA runtime/buffering work.
2. Close final-device ALSA and outstanding UPnP/Diretta CUE hardware acceptance.
3. Complete provider, Folder Browser, responsive Web and long-running multi-Control acceptance.
4. Run install, upgrade, rollback and final hardware checks on one clean candidate, then release.

## Product scope

The current release targets one user on a trusted home/LAN network. Authentication, pairing, TLS
and stricter browser-origin controls require a later accepted product requirement.

## Related documents

| Document                                                                                           | Purpose                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Atom Completed](./atom-completed.md)                                                              | Confirmed implementation and bounded acceptance history |
| [Development guide](./atom-development.md)                                                         | Environment, checks and conventions                     |
| [Build and packaging](./build-and-packaging.md), [build flavors](./build-flavors.md)               | Core/Web artifacts and variants                         |
| [Core deployment](./core-deployment.md)                                                            | systemd, durable data, install, upgrade and rollback    |
| [Hardware checklist](./hardware-release-checklist.md)                                              | ALSA, Diretta and UPnP release checks                   |
| [Provider acceptance](./live-provider-acceptance.md)                                               | Real-account criteria                                   |
| [ALSA plan](./alsa-output-plan.md), [UPnP plan](./upnp-output-plan.md)                             | Output implementation and remaining checks              |
| [Folder Browser plan](./local-folder-browser-plan.md), [responsive plan](./web-responsive-plan.md) | Web feature and device criteria                         |
| [Direct CUE plan](./direct-cue-gapless-plan.md), [lyric plan](./lyric-improvements.md)             | Gapless and lyric implementation                        |
