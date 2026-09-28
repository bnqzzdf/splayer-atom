# 2026-09-22 ALSA and release-artifact acceptance

> Last updated: 2026-09-28

This record applies only to the `cecee166` artifact described below. The later `c3e135ab`
artifact already fixes Processed PCM seek and direct Play after restart in software; the FAIL
results in this record are the measured outcome for that older artifact, and hardware
re-verification of the fixed artifact is still tracked in [Roadmap](./atom-roadmap.md).

Environment: Linux 7.0.0-31-generic x86-64, HiBy FC4, Diretta DX5 II, Node 24.18.0.
Real outputs were operated through the installed Core's HTTP API; at the end of the test the
original queue, FC4, and Direct mode were restored, playback stayed stopped, and the ALSA handle
was closed. FC4 USB authorization was restored, and the temporarily loaded usbmon was unloaded.

## Release artifact identity and smoke

- Source commit: `cecee166b5c3014d0221a2573965314dfda79d98`, artifact records `sourceDirty=false`.
- Artifact: `splayer-atom-core-1.1.0-20260922-diretta-v3-bundled-linux-x64.tar.gz` (naming rule at the time, which did not yet include the commit id and build timestamp; see [Build and Packaging](./build-and-packaging.md) for the current rule).
- SHA256: `b9ec85e6f9d4fac0936caf23f6e0062422b7852933f57728dd5bba7524050a1d`.
- The 220 matching non-data files in the install directory were compared one by one against the
  archive contents, with 0 differences.
- Unpacked in a temporary directory and ran the check logic of the existing
  `check-core-artifact.ts`; the temporary copy only adjusted the archive path and module
  resolution path, with the check logic unchanged. Native loading, HTTP, Web, session, library,
  cache, WebSocket multiple clients/disconnect-reconnect, SIGTERM, and restart on the same data
  all passed.

## ALSA USB submitted-data comparison

Using the usbmon binary interface with tcpdump, only the FC4's audio ISO OUT endpoint was
captured; keyboard/HID and other USB device payloads were not captured. Capture started first,
then playback was started from the beginning of the track through Core and stopped after about
8 seconds. Each URB's ISO descriptor was parsed, and the valid audio payload was reassembled by
offset/length.

The PCM reference was decoded independently with `ffmpeg` to `s16le`; the DSD reference was read
directly from the DSF, de-interleaved by the channel block declared in the file, with LSB-first
bytes converted to MSB-first and interleaved per the four-byte slot per channel of `DSD_U32_BE`.
No Atom packing function was used to produce the reference values.

| Item                                          | PCM                                      | Native DSD                                 |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| Source                                        | Brahms / Haydn Variations, FLAC          | Accardo / Beethoven Op.40, DSF             |
| Source format                                 | 44100 Hz / 16-bit / 2 channels           | DSD64 / 2822400 bit/s/channel / 2 channels |
| HW format                                     | `S16_LE`, 44100 frame/s                  | `DSD_U32_BE`, 88200 frame/s, `DOP=0`       |
| Fully captured and compared submitted payload | 1,414,748 bytes                          | 5,658,992 bytes                            |
| Result                                        | All bytes identical from source offset 0 | All bytes identical from source offset 0   |
| Truncated packets / capture drops             | 0 / 0                                    | 0 / 0                                      |

PCM source SHA256: `5f41f25289019e935fe84663b3fa2a835729f8cfefb7114512e3556f1895e9a8`.
DSD source SHA256: `7925b903b625fa4719fe02c1bc69d412bbe596f67fd0181d066affea7e2c0acc`.
PCM payload SHA256: `0c71647fd4fd714360e1057af3601991b99a8a6ffeabad740855e110d347ca80`.
DSD payload SHA256: `d752bd949ef9d7c6f25ec1148c1dfbed1078b899446d9d43f44b375f53e03dd3`.

The successfully completed URBs were 10414 / 9612 respectively; on explicit stop, 12 in-flight
URBs were cancelled in each case (`-104`). The comparison target is all captured submitted
payloads, including submitted data that may not have played yet at the stop. This verifies that
this continuous segment had no sample alteration, omission, or duplication at the USB driver
submission layer; it does not verify whole-track EOF tail frames, DAC-internal processing, or the
final digital output. The [kernel usbmon documentation](https://docs.kernel.org/usb/usbmon.html)
states explicitly that this interface observes the requests submitted by the device driver to the
Host Controller Driver and does not guarantee equivalence to physical bus transactions.
It is therefore recorded as independent software output-data evidence, while the final device
bit-test/digital capture remains a separate acceptance item.

## Lifecycle and output regression

| Check                                                         | Result  | Observation                                                                                                                                          |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| systemd restart during playback                               | PASS    | Old PID exits, new PID starts, queue preserved                                                                                                       |
| Direct POST `/api/play` after restart                         | FAIL    | HTTP succeeds, but still idle with position 0; explicitly selecting a track plays normally                                                           |
| SIGTERM during playback                                       | PASS    | `Result=success`, `ExecMainStatus=0`, sound card state closed                                                                                        |
| Explicit track selection after systemd start                  | PASS    | PCM playback and progress normal                                                                                                                     |
| FC4 disconnect and re-online during playback                  | PASS    | authorized 0→1 applied only to the FC4 USB device; after disconnect it paused without switching device, and explicit Play resumed it after re-online |
| ALSA→Diretta PCM                                              | PASS    | exact-pcm progress advances on the DX5 II; FC4 handle closed                                                                                         |
| Diretta Native DSD64                                          | PASS    | native-dsd path and progress advance                                                                                                                 |
| Diretta→ALSA DSD64                                            | PASS    | FC4 renegotiates `DSD_U32_BE` and keeps playing                                                                                                      |
| UPnP on real hardware                                         | BLOCKED | Repeated discovery found no MediaRenderer; no emulated device was substituted                                                                        |
| UPnP / output switching / Direct shutdown software regression | PASS    | 31 existing tests pass; not counted as real-hardware UPnP evidence                                                                                   |

The first attempt only unbound the FC4 control interface and did not fully re-create the device's
PCM endpoint; that step is not treated as evidence of a product reconnect failure. After the full
USB device was restored, the disconnect/reconnect during playback and the output round-trip tests
above were run again, and all passed.
For Diretta, only the runtime behavior of the commonly used PCM and DSD64 was re-verified this
time; the maximum 768 kHz/DSD512, Target digital output, and the online materialization chain were
not re-verified. Earlier real-hardware evidence is still retained as originally recorded.

## Items not closed by this artifact

- Processed PCM seek: the previously measured HTTP 400 is still not fixed; see the reproduction
  record in the hardware checklist.
- `/api/play` after restart: `playbackSession.ts` only loads the queue when stopped or when no
  index is selected; after restore, an idle state with a valid index calls native play directly
  with no loaded source, which matches the measured behavior.
- Unified runtime / producer-writer responsibilities: the code audit still does not conform to the
  original implementation design.
  The following is a snapshot from 2026-09-22; later refactoring has changed these details:
  `player/mod.rs` keeps separate `playback`, `decoder_thread`, and `direct_playback`;
  `alsa/processed_pcm.rs::run_writer` still performs `packed.resize`, the final gain/limiter, and
  packing.
  Passing playback tests cannot substitute for these structural changes.
- Full release acceptance still does not pass: the functional failures above, the absent UPnP
  device, the final device bit-level verification, and the highest-format/online/upgrade-rollback
  items not re-run this time cannot be replaced by the basic artifact smoke.

This run only performed verification and record updates, and did not modify or replace production
code. The raw capture, the independent comparison script, the lifecycle responses, and the smoke
output are kept on the test host at `/tmp/atom-alsa-acceptance-20260922/`; this document preserves
the durable conclusions, and the temporary files are not the only record.
