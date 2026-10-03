# SPlayer Atom hardware release checklist

> Last updated: 2026-10-03

This document records the manual acceptance steps for a target audio host. Source builds, fixtures and
fake ALSA/Diretta cannot replace functional verification on the actual output device; DAC-side
bitstream evidence is required only when making an end-to-end accuracy claim.

> **Scope note (what is a historical record and what is an outstanding checklist)**
>
> - **Historical record**: the two sections "Development-period real-hardware evidence obtained so far"
>   and "2026-09-22 local automated measurement supplement" record development-period real-hardware
>   results that are already complete and whose conclusions are settled; they do not need to be redone.
> - **Outstanding checklist**: starting from "## 1. Prerequisites" below, this is the checklist that must
>   be executed item by item against the **final clean artifact prepared for release**, with a record kept.
>
> A historical record cannot replace the outstanding checklist: what has been verified is the
> implementation principle, and the release package still has to re-run a release-candidate hardware
> smoke with the final artifact.

## Development-period real-hardware evidence obtained so far

The following capabilities have already been completed on a real Diretta Host / Target / DAC chain and
are no longer kept as "unknown capabilities":

- exact PCM Source Direct has completed bit-perfect real-hardware verification and covers up to
  PCM 768 kHz; every PCM sample-rate tier actually supported below that has completed playback
  verification.
- Native DSD Source Direct has completed bit-perfect real-hardware verification of the logical one-bit
  sequence and covers up to DSD512; every Native DSD rate tier actually supported below that has
  completed playback verification.
- A mixed PCM and Native DSD format queue has completed overnight looping long-duration playback; no
  playback interruption or format-switch anomaly was observed across continuous format transitions.

The ALSA HW dual-mode implementation has separate development-period real-hardware records, confirmed by
the user on 2026-09-22:

- Two days of actual listening, covering Direct/Processed and their respective supported PCM/Native DSD.
- Pause, seeking, track switching and output switching were all tested; seeking and playback are normal.
- Source and sound-card output parameters were compared through `/proc/asound/.../stream0`, confirming
  that the sample rate and bit depth match.

This completes the development-period listening, parameter cross-check and lifecycle acceptance for the
scope above; matching parameters do not mean that valid PCM samples or the DSD logical bit sequence have
been compared bit by bit. The later independent USB driver submission-layer comparison is recorded in
the [ALSA acceptance record](./alsa-acceptance-2026-09-22.md); the final release package still requires
separate acceptance. That layer of evidence supports the software output guarantee and does not mean the
DAC-side digital output has been verified bit by bit.

### 2026-09-22 local automated measurement supplement

Measured through the HTTP playback interface of a running Core, reading `/proc/asound/card2/stream0`,
`pcm0p/sub0/hw_params` and `pcm0p/sub0/status` for cross-checking, without bypassing Atom with an
external player. The Core was the installed 1.1.0, commit
`cecee166b5c3014d0221a2573965314dfda79d98`, `sourceDirty=false`, consistent with the source under this
audit; the device was `alsa:hw:CARD=FC4,DEV=0` (HiBy FC4).

| Path              | Source                                                                                       | Actual ALSA output                                 | Result                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Direct PCM        | Brahms / Haydn Variations, FLAC, 44.1 kHz, 16-bit, two channels; cross-checked with ffprobe  | `S16_LE`, 44100 Hz, 2 channels, `RUNNING`          | Playback progress advances, pause position holds, resume, and seek to 60 seconds all pass |
| Direct Native DSD | Accardo / Beethoven Op.40, DSF, DSD64, two channels; cross-checked by reading the DSF header | `DSD_U32_BE`, 88200 frame/s, 2 channels, `RUNNING` | Playback progress advances, pause position holds, resume, and seek to 60 seconds all pass |
| Processed PCM     | The same FLAC                                                                                | `S32_LE`, 44100 Hz, 2 channels, `RUNNING`          | Normal playback and progress advance pass; seek fails, see below                          |

For DSD, 88200 frame/s × 32 bit per frame per channel = 2822400 bit/s, i.e. native DSD64;
USB altset 4 declares `DOP=0`. The DSD transport frame rate must not be mistaken for PCM resampling.
PCM seeking to the end of the track and then automatically switching to DSD, as well as manually
switching back from DSD to PCM, both renegotiated and played successfully.

**Problem found: Processed PCM seek.** In the first round, after switching to Processed, seeking to
30 seconds returned HTTP 400. The same FLAC was then reloaded as Processed from a stopped state, and
seeking to 30 seconds still failed; after resuming playback, seeking to 60 seconds failed again. The
response was always `[Other] processed playback 缺少已协商 ALSA 输出`, and the player switched to
paused, the position reset to zero and the output path was cleared. In the same period the Core log
showed `native outputFailed, playback paused for explicit recovery`. This reproduction covers a failure
path that the user listening record had not yet exposed. After the `c3e135ab` fix, FC4 re-verification
was completed on the `3e420f78` package, which includes the fix; see the
[2026-09-23 record](./alsa-acceptance-2026-09-23.md). This failure remains a historical result of the
old `cecee166` package and does not represent acceptance of a later release candidate.

Both rounds of testing ended by restoring the original queue, Direct mode and the original FC4 output,
leaving it stopped, with the device PCM state `closed`. Raw snapshots, check results and reproduction
responses are stored on the test host at `/tmp/atom-alsa-live-20260922/`; the durable conclusions are
kept here, and temporary files are not the only acceptance record. The first round of testing above did
not perform bit-by-bit digital output capture, and did not execute a service restart/SIGTERM, an upgrade
rollback or the full release checks.

Later verification on the same day completed a byte-by-byte comparison of USB submission data, Diretta
round-trip switching, restart/SIGTERM during playback, FC4 disconnect and reconnect, and a clean
artifact smoke, and found the problem that pressing Play directly after a restart does not load the
queue. That software problem was likewise fixed in `c3e135ab` and re-verified on FC4 with the
`3e420f78` package. The full scope, results, package/source hashes and evidence boundaries are in
[2026-09-22 ALSA and release package measurement](./alsa-acceptance-2026-09-22.md).

These results belong to the current development-period hardware baseline. A formal release does not need
to re-prove the verified implementation principle, but it must still use the **final clean artifact**
prepared for release to run one release-candidate hardware smoke, to prove that the release package,
native features, Diretta SDK and the verified source path are consistent.

## 1. Prerequisites

- Use a Linux x86-64 Core `tar.gz` built from a clean checkout that has passed the final-artifact smoke.
- Formal builds use reference Node `24.18.0`; the minimum requirement for running under system-runtime is Node `22.19.0`, and bundled-runtime must confirm that the actual process uses the Node inside the package.
- A Diretta-branded artifact must record `diretta=true`, `direttaSdkRelease=150`, and be produced by the controlled SDK 150 gate.
- ALSA acceptance uses an explicit real `alsa:hw:*` device and does not substitute `default`, PipeWire or PulseAudio.
- The Linux Diretta Host Core runs as root; a normal user discovering a Target does not mean it has permission to connect.
- Set up the acceptance queue in Web Control in advance. The diagnostic script does not insert, rewrite or clear the queue.

The recommended queue contains at least:

- Lossless PCM at two or more source sample rates; the current development-period Diretta real-hardware
  coverage ceiling is 768 kHz, and the release smoke re-verifies at least one common rate and the
  highest promised rate.
- Native DSD; the current development-period Diretta real-hardware coverage ceiling is DSD512, and the
  release smoke re-verifies at least one common DSD rate and the highest promised rate.
- Three consecutive tracks, for Core-owned auto-next and long-play.
- One online HTTP lossless Track, for Diretta exact-byte materialization.

## 2. Default read-only diagnostics

The Core default address is `http://127.0.0.1:14558`:

```bash
ARTIFACT=/path/to/the-built-system-linux-x64.tar.gz
pnpm check:hardware-release -- \
  --artifact "$ARTIFACT"
```

Run the checklist against an artifact built from the target Git commit, and record and cross-check the
`atomCommit` in the artifact's `runtime.json` to confirm its source identity.

A remote trusted-LAN Core uses an explicit origin:

```bash
pnpm check:hardware-release -- --base-url http://192.168.1.20:14558
```

The default invocation reads only `/api/info`, `/api/status`, `/api/session` and
`/api/output/devices`. The output contains the artifact SHA256, Core identity/capability, categorized
ALSA/Diretta outputs, player state and sanitized session metadata; it does not output local paths,
cover-art URLs or the final playable URL.

`scripts/atom/check-hardware-release.ts` prints the report as JSON, and the report top level contains
`schemaVersion` and `readOnly`: `readOnly` being `true` means this run performed read-only diagnostics
only and executed no `--select-output` / `--play-*` action
(`scripts/atom/check-hardware-release.ts:369-371`). When `errors` is non-empty or any action is `FAIL`,
the script sets the exit code to 1 (`scripts/atom/check-hardware-release.ts:418-419`), so it can be used
directly as a gate: a non-zero exit code from the default read-only run means the diagnostics themselves
found a problem.

A Diretta discovery failure on `/api/output/devices` records only that endpoint's error. Do not treat
user-space discovery success as proof of connection permission, and do not infer from a
discovery/connection timeout that the Target is broken, occupied or should be reset.

## 3. Explicit playback and output actions

Run the default read-only diagnostics first, and copy the actual queue index and output id from the
report. The parameters below change the current output or playback state and must be explicitly executed
by the acceptor.

### PCM / ALSA

```bash
pnpm check:hardware-release -- \
  --select-output 'alsa:hw:CARD=USB,DEV=0' \
  --play-pcm-index 0
```

The script confirms that the queue metadata is PCM before sending the playback command. The acceptor
must manually record the sample rate, bit depth and channels shown by the DAC; the script cannot prove
the final hardware bitstream from the Control Protocol.

### Native DSD / Diretta

```bash
pnpm check:hardware-release -- \
  --select-output 'diretta:TARGET_ID' \
  --play-dsd-index 1
```

The script confirms that the queue metadata is Native DSD before sending the playback command.
Acceptance must manually confirm that the Target/DAC shows the native DSD rate and channels, and that
there is no PCM fallback, DoP, resampling, volume processing, DSP or DSD-to-PCM.

If the Target does not accept exactly the same format, the expected result is an explicit failure. A
Source Direct failure must not be bypassed by rewriting settings, queue, database, software volume or
output format.

### Auto-next / long-play

```bash
pnpm check:hardware-release -- \
  --play-pcm-index 0 \
  --observe-seconds 1800 \
  --expect-advances 2
```

The observation only polls the authoritative `/api/session`; it does not trigger next.
`observedAdvances` only proves Track boundary changes in the Core session; actual continuous sound,
absence of pops/truncation and the DAC indication still require manual confirmation.

### Output switch

Execute an explicit `--select-output` for the ALSA and Diretta outputs respectively, recording each
time:

- The selected output before and after the switch.
- Whether the current Track continues playing after Core reload/materialize.
- Whether the sample rate / DSD indication still matches the source after the switch.
- Whether the subsequent auto-next is still completed by Core.
- Whether failure remains explicit and does not silently switch back to another output.

## 4. Acceptance matrix

Record `PASS`, `FAIL` or `BLOCKED` for each combination; software fixtures must not be used to fill in
for real-hardware results:

- ALSA: PCM rates / bit depths / channels.
- ALSA: Native DSD (only when the product path explicitly supports that device combination).
- Diretta: PCM verified up to 768 kHz and the supported rates below it; the release candidate re-verifies
  representative rate / bit depth / channels and the highest promised rate.
- Diretta: Native DSD verified up to DSD512 and the supported rates below it; the release candidate
  re-verifies representative DSD rate / channels / equivalent bit order and the highest promised rate.
- Local files and online HTTP lossless materialization.
- Single-track start/stop, three-track auto-next, ALSA ↔ Diretta output switch.
- The mixed PCM/DSD overnight loop is already complete; for the release candidate it is enough to record
  short continuous playback, Track count, error/recovery counts and memory trend for the final artifact,
  unless this release changed the playback/output lifecycle.
- Service lifecycle: on systemd targets run `systemctl start/stop/restart`; on OpenRC targets
  (GentooPlayer) run `rc-service start/stop/restart` (`status` exits 0=started, 3=stopped). Exercise
  SIGTERM, upgrade and rollback on both; see
  [GentooPlayer (OpenRC) Service Management](./gentooplayer-openrc.md).

## 5. Acceptance record template

```text
Result: PASS | FAIL | BLOCKED
Date/timezone:
Operator:

Artifact file:
Artifact SHA256:
Atom version / commit / sourceDirty:
Core protocol / Node variant / Node version:
Diretta capability / Host SDK release:

Distro / kernel / arch:
DAC / ALSA device id:
Diretta Target:
Source kind / codec / rate / bits / channels / DSD rate:
Expected DAC indication:
Observed DAC indication:

Auto-next observed / expected:
Output switch result:
Continuous-play duration / tracks:
Memory start / peak / end:
Failure step and exact sanitized error:
User-selected sanitized log attachment:
Notes:
```

Records must not contain cookies, tokens, Authorization, provider credentials, the final playable URL,
unnecessary private paths or complete private logs. If a log is needed, attach only the minimal excerpt
that the acceptor explicitly selected and sanitized.
