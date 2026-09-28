# Direct CUE Gapless Playback Plan

> Last updated: 2026-09-28

This document records the Diretta Source Direct CUE gapless playback plan for SPlayer Atom and its
current implementation status.

Status (current code, 2026-09-23): the Core 75fps CUE coordinates, staging/boundary commit and
Native Direct PCM/DSD segment handoff are implemented, and the automated results are in section 14.
The real Diretta hardware acceptance in section 15 has no complete passing record yet, so the final
acceptance of the plan remains open.

The goal is to solve boundary leakage, clicks, repeated loading and unstable switching of CUE virtual
tracks on the Direct path, while preserving Atom's existing Core single playback authority and Source
Direct invariants.

This document only discusses CUE, Diretta Source Direct, Native staging/handoff and Core playback
authority; it does not discuss UPnP.

## 1. Final conclusion

The adopted architecture is:

```text
Core: the only queue/index/repeat/shuffle/candidate authority
Native: the current Direct segment + one staged candidate + precise audio boundary + Diretta connection
Web: only sends high-level commands and consumes Core snapshots and events
```

A normal Direct CUE boundary is completed precisely by Native:

```text
Native precisely ends the current CUE segment
    -> switches to the staged next segment over the same Diretta connection/ring
    -> Native records one DirectTrackBoundary
    -> Core commits queue/index/now-playing
    -> Core stages the track after next
```

A normal Direct CUE no longer depends on:

```text
Core position timer
    -> pauseImmediately()
    -> next()
    -> full load/reconnect
```

Non-Direct outputs continue to use the original CUE master + Core timeline behavior.

## 2. Key invariants

The implementation must continue to satisfy:

- Core is the only authority for the playback queue, the current index and playback policy;
- Native does not understand the full queue, repeat or shuffle, and does not create a second
  scheduler;
- Web does not hold the Direct recovery state machine;
- PCM keeps the source sample rate, channel count, effective integer bit depth and sample value;
- Native DSD keeps the source bit rate, channel count and logical one-bit sequence;
- no resample, remix, float DSP, software volume, ReplayGain or fade is introduced for CUE
  boundaries;
- the Native realtime callback adds no allocation, lock, log, file open or format negotiation;
- a staging failure only affects the next track's preload and does not interrupt the Direct source
  currently playing.

## 3. Precise CUE coordinates: 75fps INDEX, not milliseconds

The raw CUE time coordinate is `MM:SS:FF`, where `FF` is 75fps.

Atom previously stored only:

```ts
cueStartMs;
cueEndMs;
```

Milliseconds are not enough to describe a precise Source Direct boundary. For example, one CUE frame
of 44.1 kHz PCM should be exactly:

```text
44100 / 75 = 588 samples/channel
```

If `00:00:01` is first rounded to 13 ms and then converted, the result is about 573 samples, already
off by 15 samples.

Therefore the canonical `Track` now additionally stores:

```ts
cueStartFrame75: number
cueEndFrame75?: number
```

The semantics are as follows:

- `cueStartFrame75`: the raw integer `INDEX 01` coordinate of the current Track;
- `cueEndFrame75`: the `INDEX 01` of the next Track;
- the last track has no next INDEX, so `cueEndFrame75` is omitted and it plays directly to the
  physical EOF;
- `cueStartMs/cueEndMs` are retained for the UI, ordinary outputs and compatibility paths, but can no
  longer be the basis for precise Direct trimming.

The database schema has been upgraded, with a one-time migration for old CUE data:

- the start can be recovered from the old millisecond value to the nearest 75fps INDEX;
- the end is only backfilled when a next entry with `cueStartMs == current.cueEndMs` really exists in
  the same CUE;
- the last track does not mistake the physical EOF for the next INDEX.

The old `playback_session` JSON may also lack the frame75 fields. When restoring a session, these
coordinates must be filled in from the canonical Track of the current library; the end must not be
guessed directly from milliseconds. When no canonical Track is found, the old data is kept, but
Direct preload skips precise segment staging to avoid incorrect truncation.

## 4. Core staging authority and generation

No "globally unique generation" or new scheduling layer is introduced; the existing tokens, each
with a clear responsibility, continue to be used:

- `loadGeneration`: the Core session lifecycle such as the current load / old CUE timer;
- `preloadToken`: whether the current next-track preload is still valid;
- `directGeneration`: the boundary identity of a staged Direct candidate;
- Native staging epoch: invalidates a staged candidate that has not yet entered the ring.

These tokens should not be forcibly merged. They correspond to different lifecycles, and keeping
their existing responsibilities is actually simpler.

The following changes invalidate the current preload/staging:

- a manual track change or stop;
- queue modification or reordering;
- a shuffle/repeat policy change;
- an output switch;
- a change to the next candidate Track or its actual source;
- a Direct policy change.

`buildPreloadKey()` already includes the CUE's `cueStartFrame75/cueEndFrame75`, so a change to the
CUE segment itself also invalidates the old candidate.

## 5. Core -> Native segment interface

This work adds no pseudo-path and builds no extra DTO layer for the sake of "structure".

The existing N-API methods directly gain two optional integer parameters:

```ts
load(source, autoPlay?, cueStartFrame75?, cueEndFrame75?)
stageDirectNext(source, durationSecs, generation, cueStartFrame75?, cueEndFrame75?)
commitDirectGaplessBoundary(source, durationSecs, cueStartFrame75?, cueEndFrame75?)
```

These types are generated automatically by napi-rs into `native/audio-engine/index.d.ts`; a second
hand-written set of Native addon types is not maintained.

Native itself converts the 75fps INDEX into native units based on the actual PCM sample rate / DSD
bit rate it has already probed, so Core does not need to know the decoded sample rate in advance, nor
does it need to treat `bigint sample frame` as another cross-layer protocol.

## 6. The current segment and the staged segment use the same semantics

Supporting only the "next segment" is still not enough. The CUE Track currently playing must know its
own precise end from the very first audio block; otherwise the producer could prefill subsequent
master data before Core later issues stop/end.

Therefore both the current load and the staged load carry the same CUE segment:

```text
physical source
startFrame75
endFrame75 | physical EOF
```

The behavior of the Native producer is:

1. open or precisely seek to the segment start;
2. record the remaining PCM frames / DSD bits of the current segment;
3. deduct the remaining length on every ring slot fill;
4. precisely trim the payload when the last slot crosses the boundary;
5. once the remaining length reaches zero, stop reading subsequent master content;
6. when a staged candidate exists, install its first block and mark the boundary;
7. when no staged candidate exists, enter the real `Ended`.

"Sharing one decoder for the same master" is not optimized. Adjacent CUE Tracks may each stage their
own decoder/reader; this is simpler and more stable than introducing a shared decoder lifecycle and an
extra state machine.

## 7. Precise PCM boundary

PCM uses the source sample rate to convert the CUE INDEX into a sample frame:

```text
sampleFrame = cueFrame75 * sampleRate / 75
```

It must be divisible by 75; otherwise this sample rate cannot express that CUE time point precisely,
and the Direct path explicitly reports it as unsupported instead of rounding.

For example:

```text
44.1 kHz: 1 CUE frame = 588 samples/channel
48 kHz:   1 CUE frame = 640 samples/channel
```

The PCM producer already implements:

- precise seek to the target sample frame;
- segment-relative seek;
- tail trim of the last `DirectPcmFrame` block;
- synchronous correction of the payload length and logical samples/channel;
- no sample after the boundary is written into the ring.

Direct PCM staged handoff is allowed only when the following wire/source semantics are compatible:

- the same sample rate;
- the same channels;
- the same effective valid bits;
- the same storage bits;
- the same integer sample format.

When they are incompatible, let the current segment end normally and have Core perform a full
reconnect/load.

## 8. Precise Native DSD boundary

DSD uses the source bit clock:

```text
bitsPerChannel = cueFrame75 * dsdBitRate / 75
```

Besides the requirement of divisibility by 75, the `DSD_SIZ_32` of the current Diretta Native DSD
transport must also be satisfied:

```text
bitsPerChannel % 32 == 0
```

One CUE frame of standard DSD64 is:

```text
2,822,400 / 75 = 37,632 bits/channel = 4,704 bytes/channel
```

Therefore a normal CUE INDEX at a standard DSD rate can be expressed precisely in Native transport
units.

The implementation preserves:

- the original DSD bit rate;
- the channel count;
- the logical one-bit sequence;
- the DSF/DFF source bit-order -> current wire bit-order adaptation where necessary.

The source container or source bit order is not required to be identical, as long as it can be
losslessly adapted to the already existing Diretta wire bit order. A full reconnect must not be forced
just because DSF and DFF represent data differently.

When the precise 75fps/32-bit alignment cannot be satisfied, it fails explicitly; there is no
padding, no silent bit dropping, and no conversion to PCM/DoP.

## 9. Direct CUE position and seek

Ordinary non-Direct CUE such as ALSA still uses the original absolute master position:

```text
engine position = cueStartMs + track-relative position
```

A Direct segment instead exposes a segment-relative position from Native itself:

```text
current virtual Track start = 0
```

Therefore `playerTimeline.ts` distinguishes ordinary CUE from Direct CUE:

- non-Direct: continue to subtract/add `cueStartMs`;
- Direct segment: the position is already the virtual Track-relative position, so the start is no
  longer subtracted again;
- Direct seek accepts Track-relative seconds, and Native then maps them to
  `physical start + relative offset`, while preserving the current segment end.

This avoids Core subtracting the CUE start a second time from a Native position that has already been
reset to zero after a gapless handoff.

`onNativePosition()` exits directly for an active Direct segment, so the Core timer no longer
participates in a normal Direct CUE boundary.

## 10. Boundary, duplicate and stale

A Native boundary means "the audio handoff has actually happened", not "is about to happen".

The producer first puts the first block of the staged candidate into the ring; only when the SDK
callback actually takes the first block carrying the boundary does the Native monitor increment the
transition count and record the generation. Core's background event thread then sends the
`DirectTrackBoundary` to JS, so by the time the event reaches Core, Native has already switched to the
next source.

Two important conclusions follow:

### Duplicate boundary

The same generation must be consumed idempotently. Core keeps the last processed generation, and a
duplicate event is treated as already consumed; it must not advance the queue, statistics or scrobble
again.

### Stale boundary

Stale cannot simply be "recorded and discarded". Receiving this event means Native has really played
the old staged candidate.

The current policy is:

1. generation/candidate can be matched -> commit the Core queue/index normally;
2. generation has already been committed -> duplicate, ignore it directly;
3. no corresponding prepared candidate is found -> treat it as a real stale handoff, immediately stop
   the current Native output, and then recover according to Core's current queue/repeat authority.

This recovery path is used only when a race anomaly occurs; it is not the normal scheduling path.

## 11. Manual operations, cancellation and the ring race

When the Core queue/policy changes, Core immediately:

- increments the preload token;
- clears the prepared candidate;
- calls Native `cancelDirectNext()` to invalidate a staged candidate that has not yet entered the
  ring;
- cleans up the materialized Direct input when necessary.

A candidate that has already entered the ring cannot be safely withdrawn by ordinary mutex
cancellation, because the realtime callback may already be approaching or crossing the boundary. For
this reason the stale-handoff recovery of section 10 is kept, instead of adding a complex queue
rewriting state machine inside the callback.

## 12. Staging failure and cross-format fallback

A staging failure does not affect continued playback of the current track.

After the current segment reaches its precise end:

- a valid same-format staged candidate exists -> Native gapless handoff;
- no candidate -> Native `Ended`;
- Core then loads the next track normally according to the existing queue policy.

Gapless is not forced in the following cases:

- PCM sample rate / channels / valid bits / storage/sample format are incompatible;
- PCM <-> DSD;
- the DSD bit rate / channels cannot preserve the current wire transport;
- the CUE 75fps cannot be mapped precisely to native sample/bit units;
- source staging, download or materialization fails.

Correctness takes priority over "looking gapless".

## 13. Old data compatibility

Old library data obtains the frame75 fields through a database migration.

An old `playback_session` / renderer legacy queue may still carry old Track JSON, so restoring it
will:

1. find the local CUE Track id;
2. re-obtain `cueStartFrame75/cueEndFrame75` from the current library canonical Track;
3. fill in only the precise CUE coordinates, without overwriting the queue context or other playback
   metadata;
4. if the canonical Track does not exist, do not guess the end from milliseconds;
5. a CUE Track lacking canonical 75fps boundaries does not participate in Direct preload staging.

This keeps old queues recoverable after an upgrade, and does not misinterpret the physical EOF of the
last track as the next INDEX.

## 14. Current automated verification

As of 2026-09-16, the following have been verified:

- the CUE parser preserves the raw 75fps INDEX;
- the database v6 migration correctly distinguishes middle tracks from the last track;
- the old persisted playback queue can recover frame75 from the canonical library Track;
- 1 CUE frame of PCM 44.1 kHz is exactly 588 frames;
- 1 CUE frame of Native DSD64 is exactly 37,632 bits/channel;
- a DSD bit rate that cannot be mapped precisely is rejected;
- PCM/DSD staged handoff keeps the existing bit/sample contiguous tests;
- all `audio-engine-core` unit and integration tests pass;
- `cargo check` with the local Diretta SDK passes;
- the project's official `build:native --dev --require-diretta --diretta-variant=v3` can generate
  both native addons;
- the Node TypeScript typecheck passes;
- the targeted Core tests for Direct/CUE/database pass.

## 15. Still requires real hardware acceptance

Automated tests cannot replace a real Diretta Host/Target. Before release, at least the following
should still be verified on real Linux x86-64 devices:

1. three or more PCM CUE tracks playing gapless in a row;
2. no audible leakage, click or repeated beginning around a CUE boundary;
3. continuous DSD CUE playback;
4. CUE -> ordinary full track, ordinary full track -> CUE;
5. same-format handoff keeping the same connection;
6. an explicit full reconnect across sample rate / PCM-DSD;
7. stale recovery does not keep playing the wrong thing when the queue is changed immediately around
   a boundary;
8. after a seek within a segment, playback is still at the correct physical position and keeps the
   correct end;
9. repeat-one, shuffle, manual next/prev and stop;
10. no ring/source/connection leak and no duplicate statistics during long continuous playback.

## 16. Main implementation locations

Core:

```text
core/services/cue.ts
core/services/playerTimeline.ts
core/services/playerLoad.ts
core/services/playbackPreloader.ts
core/services/directGapless.ts
core/services/playbackSession.ts
core/database/migration.ts
core/database/playbackSession.ts
```

Native:

```text
native/audio-engine-core/src/direct_runtime.rs
native/audio-engine-core/src/direct_pcm.rs
native/audio-engine-core/src/direct_dsd.rs
native/audio-engine-core/src/diretta/mod.rs
native/audio-engine-core/src/player/mod.rs
native/audio-engine-core/src/player/background.rs
native/audio-engine/src/bindings/player.rs
native/audio-engine/index.d.ts
```

## 17. Implementation review checklist

- Web has no second playback/queue authority;
- Native has no full queue and no second playback policy;
- no new watchdog, fixed time window or global static handoff flag is added;
- the precise Direct boundary uses only the 75fps INDEX and does not rely on back-inference from
  milliseconds;
- the last track's end is the physical EOF, with no fabricated frame75;
- the current and staged CUE use the same segment semantics;
- the last PCM frame is precisely tail trimmed;
- DSD preserves the logical bit sequence and satisfies `DSD_SIZ_32`;
- the Direct segment position/seek is Track-relative;
- a duplicate boundary is idempotent;
- a stale boundary is handled as "Native has already really handed off";
- the realtime callback adds no lock, allocation, log, discovery or format negotiation;
- staging/cross-format failure has an explicit fallback;
- no facade, adapter or second state machine is added for formal symmetry.
