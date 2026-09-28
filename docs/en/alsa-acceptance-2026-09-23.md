# 2026-09-23 FC4 fix package re-verification

> Last updated: 2026-09-28

This record only verifies the two faults targeted by `c3e135ab`, and does not replace full ALSA
or release acceptance.

## Environment and artifact identity

- Installed Core: `/opt/splayer-atom-core`; `runtime.json` records the source commit
  `3e420f7811555163ed5b450b35b3cf6d3a4e1b26`, `sourceDirty=false`, version `1.1.0`, and
  Diretta SDK 150; that commit contains `c3e135ab`.
- Linux x86-64; HiBy FC4 USB, Core systemd service listening on 14560.
- The current single-track local 44.1 kHz / 16-bit / 2-channel FLAC queue was operated through the
  Core HTTP API. This run did not rebuild or compare an archive, and did not verify source changes
  made after this record.

## Fault re-test

| Check                                     | Result | Actual observation                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FC4 Processed PCM seek                    | PASS   | After switching to Processed and playing the current track, seeking to 30 s and 60 s respectively; both HTTP responses were 200, the state stayed playing, the path was `processed-pcm`, and the observed position advanced to about 31.9 s and 61.9 s respectively.                            |
| Direct Play after restart during playback | PASS   | Switched back to FC4 Direct and played; after `systemctl restart splayer-atom-core` the restored queue still had one track with index 0 and state idle; a direct `POST /api/play` returned 200, and after about 2 s the state was playing, the position about 1.94 s, and the path `exact-pcm`. |

After the run, FC4, Direct, the single-track queue, and the original paused position of about
2.96 s were restored; the service stayed running.
These two faults of the older artifact no longer reproduce on the installed fixed artifact above.
The final release candidate still needs re-verification against its own commit and artifact
identity.
