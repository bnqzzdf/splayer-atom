# ALSA source-faithful playback complete implementation plan

> Last updated: 2026-09-28

Date: 2026-09-20.

Status (current code, 2026-09-23): the ALSA HW dual mode, PCM/Native DSD, Core/Web control, and CPAL
removal are implemented; the user confirmed two days of actual listening, covering Direct/Processed,
the PCM/Native DSD each supports, pause, seek, track switching, and output switching, and confirmed
by comparing `/proc/asound/.../stream0` that the output sample rate and bit rate match the source.
Automated testing on the local FC4 the same day confirmed Direct PCM/DSD64, pause/resume, seek, and
cross-format track switching worked, but at the time Processed PCM seek repeatedly returned "missing
negotiated ALSA output". The writer cancellation path fixed by `c3e135ab` and direct Play after
restart have been re-verified on the FC4 with the `3e420f78` package containing the fix, see the
[2026-09-23 record](./alsa-acceptance-2026-09-23.md); the old package failures are kept in the
[2026-09-22 record](./alsa-acceptance-2026-09-22.md). The current source folds Direct/Processed into
the same player runtime ownership slot; Processed final gain, limiter, packing, and buffer growth
have moved to the DSP producer. `123cbdac` corrects end-of-track decode failure classification;
`37aee7a1` completes source-time accounting for tempo delay and the EOF tail, the end-of-track
drain, and the next-track limiter reset. `9e76bfa2` bounds the queue single block and buffer pool
capacity; `53284360` makes the drain on pause without hardware follow runtime cancellation, but
there is no corresponding device verification yet. The new local release module passed
pitch-shifted/speed-changed track endings, Processed seek, and Direct basic playback on the FC4, see
the [partial-fix retest](./alsa-gap-fixes-2026-09-23.md). All three mode paths share
`AlsaFrameWriter`'s submit, short-write, and cancellation logic; each control loop handles different
source semantics, and merging the loops is not an acceptance goal. The decode/DSP queues and the
reuse pool are now bounded; with no evidence of upstream transient allocation anomalies, no
full-path byte budget or parameter-version mechanism was added. Functional regression on a clean
artifact is still pending. Independent byte-for-byte consistency evidence for PCM/DSD at the USB
driver submit layer has been obtained, and the clean artifact smoke test, restart/SIGTERM during
playback, FC4 disconnect/reconnect, and Diretta round-trip switching have passed; full release
acceptance is still incomplete. Final device bitstream testing is used only for device-level
end-to-end claims and is not a software passthrough completion condition of this plan. Scope is
detailed in the two test records above. Completion status is maintained by the
[Roadmap](./atom-roadmap.md). This document is designed as one complete goal, not split into
delivery batches that ship PCM first, add DSD later, or keep the old backend long term.

Confirmed product requirements: the same ALSA backend provides two explicit modes, "exact
passthrough" and "PCM processing"; lossy playback such as MP3/AAC and the existing PCM DSP features
are preserved. In passthrough no actionable DSP is provided, and in PCM processing the exact
passthrough marker is not shown. The main playback UI adds no persistent technical status text and
may allow a small icon or no marker at all; detailed information is only viewed on demand. The
remaining details in this document are the implementation design; the current completion scope is
governed by the status above and the Roadmap.

## 1. Final goal

Linux x86-64 Core keeps only one ALSA HW backend and explicitly selects the audio path upstream of
it:

| Rule                                                                           | Exact passthrough `direct`                                                                                | PCM processing `processed`                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Integer lossless PCM                                                           | Preserve sample values, effective bit depth, rate, channel semantics, and sequence                        | May enter float DSP; the output is not promised bit-perfect                                                              |
| Lossy/float PCM                                                                | Preserve decoded rate/channels with only necessary representation adaptation; not marked bit-perfect      | Uses the same decoder and allows the DSP that is enabled                                                                 |
| Native DSD                                                                     | Preserve the logical bit sequence, bit rate, and channels; fail if the hardware does not support it       | Not supported; prompt for an explicit switch to exact passthrough, never switch automatically or convert to PCM          |
| Software volume, mute, EQ/preamp, normalization, ReplayGain, fade, tempo/pitch | No processing instances, no effective settings, commands rejected                                         | Preserve the existing features; parameters are saved and applied by Core                                                 |
| rate/channels                                                                  | No resampling, no remix, no channel padding                                                               | May resample to adapt to a PCM device; this plan still adds no remix/channel padding                                     |
| Clipping protection                                                            | Forbidden                                                                                                 | Explicitly switchable and part of the actual DSP state; no longer an implicit 0.98 limiter on every path                 |
| Output marker                                                                  | Not persistently displayed by default; an optional small icon must match the guarantee actually in effect | No persistent text required; no passthrough icon is shown, and turning off all effects does not turn it into passthrough |

"Exact passthrough" is a mode selection, and "whether the current track is exact-passthrough" is a
runtime fact; the two must not be conflated. Under direct, a lossy source may be decoded at its
original sample rate with necessary quantization so that the previously confirmed playback support
is preserved, but it gets no bit-perfect badge; the mode selector's on-demand explanation states
this scope, and per-track technical explanations in the playback area are not required.

The two modes share the same device identity, hardware negotiation, write primitives, and player
ownership; the control loops may be implemented separately according to the actual differences of
PCM, DSD, and Processed, but a second ALSA backend or Core player must not be built. Only the HW
endpoint the user selects is opened; the desktop default is not followed and the system mixer is not
taken over. Core continues to exclusively own the queue, sources, cache, preload, retry, skip,
statistics, mode, and DSP settings. Web only sends high-level commands and consumes authoritative
state; Diretta keeps strict Source Direct, and UPnP keeps its existing independent branch.

The mode is not inferred automatically from the track format, whether all DSP parameters are zero,
or device support. No format failure triggers an automatic direct→processed fallback. Neither mode
introduces DoP/DSD-to-PCM.

Finally, delete the old CPAL output, the duplicated lifecycle, underrun silence padding, and
implicit processing; keep and migrate the DSP algorithms and dependencies that have real user-facing
functionality. During development a brief coexistence is allowed for comparison, but no old backend
may remain as a hidden fallback at completion.

### 1.1 The boundaries of bit-perfect

Source files and output bytes need not be byte-for-byte identical: FLAC decoding,
planar→interleaved, integer slot widening, and DSF/DFF bit-order and packing adaptation may all be
lossless. The comparison target is the effective PCM samples after unification into one
representation, or the logical DSD bit sequence of each channel.

The software guarantee of direct mode stops at the data submitted to the negotiated ALSA HW
interface. The precision reported by the driver, the hardware digital mixer, the DAC's internal DSP,
and the final digital output require separate acceptance. The actual software path is kept in Core
state and output details and is not forced into persistent player text; end-to-end bit-perfect
verification is not claimed on the basis of device name or sample rate.

The result of a lossy decoder is not the original recording before compression; float-to-integer
conversion may also quantize or saturate at full scale. Core still distinguishes these paths, and
the UI may add no status marker at all. A source file's "lossless/Hi-Res" label does not equal
output passthrough, and a passthrough icon must not be added merely because all DSP switches are
off.

## 2. Audit of the existing implementation and retention decisions

This section records the audit baseline before implementation; descriptions such as CPAL, the
implicit full-path limiter, and underrun silence padding do not represent the current
implementation. The scope already delivered by later changes is in the status at the top of the
document; the final dispositions in the table are still used to check design items that are not yet
complete.

**Status (2026-09-23 review)**: Landed — the CPAL dependency has been removed, `audio_output.rs` has
been rewritten as ALSA processed PCM device negotiation (138 lines), `source.rs` has been deleted,
the implicit full-path limiter has been moved out of the ordinary decoder, and silence padding has
been disabled. Not landed — `shared.rs` is not deleted (541 lines, still a bounded block queue),
`direct_runtime.rs` is not deleted (708 lines), `playback.rs` is still the `PlaybackHandle` for
processed PCM rather than a merged runtime, and `error.rs` has no mode-conflict category yet. The
corresponding rows in the table are annotated accordingly.

The current `decoder.rs` feeds decode results into an `f32` resampler for the output device format,
then into DSP. `process_audio_chunk()` still calls `OutputLimiter` with a threshold of `0.98` when
tempo is bypassed. `audio_output.rs` prefers the device default format/channels and falls back to
the default configuration when the source sample rate is unsupported, and the output callback
applies software gain and `FromSample<f32>` once more. `source.rs` inserts about 20 ms of silence on
underrun.

Therefore "turn off the audio effects and set the volume to 100%" cannot make the current chain meet
the goal. CPAL itself is not equivalent to lossy output, but this project only targets Linux, and
the new implementation needs direct control over HW identity, effective bits, Native DSD, short
writes, and device drain semantics; keeping CPAL would add a second local device and lifecycle
implementation with no independent product purpose.

| Existing code/responsibility                                    | Final disposition                                                                               | Rationale and parts that must be kept                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CPAL dependency                                                 | Removed; replaced by the single `alsa/` backend                                                 | Both modes share device enumeration, stable ID, negotiation, and the writer                                                                            |
| `audio_output.rs`                                               | Deletion not landed; currently ALSA processed device negotiation                                | No CPAL fallback remains, but `player/mod.rs:9` and `transition.rs:5` still use it directly                                                            |
| `PlaybackHandle` in `playback.rs`                               | Runtime merge not landed; currently the processed PCM handle                                    | 55 lines, holds `AlsaProcessedPcmStream` (`playback.rs:1-11`); the only `PlaybackRuntime` is in `player/mod.rs:105`                                    |
| `source.rs`, `shared.rs`                                        | `source.rs` deleted; `shared.rs` not deleted                                                    | `shared.rs` is 541 lines and is still a bounded block queue (`AudioChunk`/`PreparedPcmChunk`)                                                          |
| `decoder.rs`                                                    | Split out probing, decoding, and reusable processing steps; delete the old thread orchestration | Metadata, decoders, and processing capabilities are kept; the functionality must not be deleted wholesale                                              |
| `direct_pcm.rs`                                                 | Keep and rework                                                                                 | Exact integer decoding, reordering, seek, CUE/staging; shares the FFmpeg foundation                                                                    |
| `direct_dsd.rs`                                                 | Keep and rework, used by direct only                                                            | Decouple the container logical sequence from transport grouping; keep the strict constraints                                                           |
| `direct_runtime.rs`                                             | "Delete after merge" not landed; still registered at 708 lines                                  | Used by `player/mod.rs:12-13`, `transition.rs:8`, `bindings/player.rs:13`                                                                              |
| `player/mod.rs`, `transition.rs`, `background.rs`               | Keep the control responsibilities, trim duplicated state/threads                                | Keep load token, output generation, and events; DSP state belongs only to processed, and fade becomes an envelope in the processing graph              |
| `equalizer.rs`, `loudness.rs`, `tempo.rs`                       | Keep the algorithms and required dependencies, adapt to processed                               | Includes `signalsmith-stretch`; direct does not instantiate or call these processing steps                                                             |
| `OutputLimiter`                                                 | Move out of the ordinary decoder, become processed's explicit clipping protection               | It must not become a mandatory step for all sources; the protection switch and the actually effective state are visible                                |
| Playback resampler                                              | Migrate to a processed-only PCM rate adaptation                                                 | Not initialized on the direct integer/DSD path, and does not remix secretly                                                                            |
| `device_watcher/`                                               | Delete the placeholder backend and watcher interface                                            | Currently always returns unsupported; explicit refresh and output errors take over the real responsibility                                             |
| `core/services/device.ts`                                       | Trim to a legacy-settings compatibility entry point                                             | Does not own automatic recovery/reinit; active switching and explicit rebuild are coordinated uniformly by the Core playback session                   |
| `metadata/`, `scanner.rs`, `cue/`, `sacd/`, `dsd/` reader       | Keep                                                                                            | Scanning, tags, covers, lyrics, track splitting, and DST/DSD still have real consumers                                                                 |
| `media_extract.rs`                                              | Keep, isolated from the processing modes                                                        | UPnP strict extraction must not pass through DSP/quantization                                                                                          |
| `dsd/dsd2pcm.rs`                                                | Delete the converter and its dedicated tests                                                    | Neither mode accepts DSD-to-PCM; do not delete the whole `dsd/`                                                                                        |
| `midi/`, `rustysynth`, the `midi` feature                       | Delete the unintegrated synthesis implementation                                                | No production call sites found currently; the two modes do not expand into a MIDI product                                                              |
| Standalone `hdcd/`, `mqa/`, `dts/` processing/detection modules | Delete modules with no production consumer and their dedicated tests                            | Currently only independent tests reference them; keep real format detection/tagging/decoding consumers                                                 |
| `error.rs`                                                      | Keep the classification; "mode conflict reason" not landed                                      | `AudioErrorKind` has only six categories and no mode conflict (`error.rs:11-19`); direct rejection is still a string `bail!` (`player/mod.rs:389-396`) |
| Core resolver/session/cache/provider/stats/ListenBrainz         | Keep and wire into the new runtime                                                              | Do not rebuild the business playback system; time and effective state come from the same authority                                                     |

The audit conclusion is based on the call relationships in this repository at this time. Before
implementing deletions, check production references, features, and tests again, and migrate
responsibilities first when a real consumer is found; "the file still exists" and "it has its own
unit tests" are not sufficient reasons to keep runtime functionality. MQA/HDCD-marked PCM can be
output exactly as the actual integer source, but unfolding/decoding these additional encodings is
not promised; DTS decoding determines lossy/lossless by the actual codec; do not misjudge variants
such as DTS-HD MA because of the DTS name. IEC61937/SPDIF compressed bitstream passthrough is out of
scope for this work.

## 3. Final module structure

```text
Core playbackSession / resolver / preload / cache
                        |
    prepared local input and track boundaries
                        |
               native AudioPlayer
                        |
             single PlaybackRuntime
                 /                           \
                 ALSA path                    Diretta strict path
           /                \                 |
     direct                 processed         |
     exact PCM/DSD          PCM decode + DSP  |
     or decode without DSP  |                 |
           \                /                 |
          same ALSA transport                 Diretta transport
                   |                          |
              selected HW                     selected Target
```

The directories are organized by real responsibility, without building a generic output plugin
framework. **Status (2026-09-23 review)**: there is actually no `pcm_decode.rs` or
`pcm_processing.rs`; the processed orchestration lives in `alsa/processed_pcm.rs` +
`alsa/processed_prepare.rs`, PCM probing/decoding is still handled by `direct_pcm.rs`, and
`media_probe.rs` has landed.

```text
native/audio-engine-core/src/
  alsa/
    mod.rs               local transport entry point (module declarations)
    device.rs            HW enumeration, identity resolution, and constrained opening
    format.rs            PCM only: format candidates, negotiation, and integer packing
    dsd.rs               DSD only: DSD format negotiation and grouped packing
    output.rs            single-owner write thread, commands, progress, and drain
    writer.rs            shared AlsaFrameWriter submit, short write, and cancellation
    processed_pcm.rs     processed PCM control loop and writer orchestration
    processed_prepare.rs processed final byte preparation: gain, clipping protection, and packing
    direct_pcm.rs        ALSA direct PCM control loop
    direct_dsd.rs        ALSA direct DSD control loop
  direct_pcm.rs          exact integer decoding, source blocks, track splitting, and staging
  direct_dsd.rs          DSD reader, source blocks, track splitting, and staging
  playback.rs            PlaybackHandle for processed PCM (55 lines)
  equalizer.rs           existing EQ algorithm, used by processed only
  loudness.rs            existing normalization analysis, used by processed only
  tempo.rs               existing tempo/pitch, used by processed only
  media_probe.rs         metadata probing split out of decoder, with no output or DSP dependency
  diretta/               existing SDK transport
  player/                control, load generation, and event coordination below N-API
```

`PlaybackRuntime` is defined in `player/mod.rs:105-108` as
`enum PlaybackRuntime { Processed(ProcessedRuntime), Direct(DirectPlayback) }`;
`DirettaPcm`/`DirettaDsd` belong to another enum, `DirectMonitor` (`direct_runtime.rs:48-50`), and
are not members of `PlaybackRuntime`. The common operations cover only the existing
load/play/pause/stop/seek/stage/monitor, and device-specific semantics stay in the transport. Do not
introduce an Output registry, a second Core session, multiple active players, or an independent
output daemon.

The FFmpeg foundation may return integer/float and packed/planar frames; the strict integer adapter
still accepts only exact integer representations. ALSA selects either the direct adapter or the
processed processing graph at the producer layer, then enters the same ALSA transport. The mode is
an immutable execution parameter of that load; a boolean switch in the writer must not temporarily
reinterpret an integer stream as float. Do not copy the whole decoder, and do not relax the
constraints for Diretta/UPnP strict extraction.

The processing graph reuses existing algorithms; processed may use `f32` internally, but it does not
own the device or the queue. Software volume, fade, and protection are done on the producer side;
the writer only consumes final sample blocks. Both modes share the same output control code, and
tests must prove not only that "the entry point is different" but also that direct passes through no
processing instance at all.

The generic runtime, PCM/DSD readers, and load/seek/staging do not depend on the Diretta feature.
Only the SDK transport, discovery, connection, and dedicated wait logic are controlled by
`feature = "diretta"`. The existing 800 ms Diretta reconnect stabilization window must not be
applied to ALSA because of the runtime merge.

## 4. Source support and format negotiation

### 4.1 Source matrix

The table below defines the source guarantee scope of direct; processed uses section 4.6 for
decodable PCM and does not inherit the exact-sample promise. Lossy/float is supported in both modes,
while Native DSD is supported only in direct.

| Source                                                                     | Processing and guarantee                                                           | When not satisfied                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Integer PCM WAV/AIFF, FLAC, ALAC, APE, lossless WavPack, etc.              | Lossless decoding; exact integer output                                            | Do not reduce effective bits or quantize after converting to float; report the format as unsupported |
| Lossy formats currently decodable by FFmpeg such as MP3, AAC, Vorbis, Opus | Original sample rate/channels after decoding; one format conversion when necessary | Fail explicitly when that rate/channel is unsupported                                                |
| Float PCM files                                                            | Preserve the decoded sample rate/channels; go through explicit PCM adaptation      | Do not show the integer-lossless passthrough marker                                                  |
| DSF, DFF raw DSD, supported SACD/DST virtual tracks                        | Lossless read/decompression, Native DSD output                                     | Do not convert to PCM/DoP; fail when there is no matching Native DSD format                          |
| Mixed encodings such as WavPack hybrid                                     | Determine losslessness from the actual decode mode/correction data                 | Do not assume lossless from the extension; do not mark as an exact source when uncertain             |
| MIDI, undecodable/unknown encodings, unsupported DST container variants    | Do not claim support just because a module exists                                  | Explicitly unsupported; do not start the old path                                                    |

Classification is based on the codec, the actual decoded format, and effective-bit information, not
on a provider's "lossless" label, a URL suffix, or the file container. Opus and similar formats use
the decoder's actual output rate; do not force conversion using a hinted rate from the container.

### 4.2 PCM negotiation algorithm

The following exact constraints apply to direct; both modes use the same negotiation implementation,
with an explicit policy deciding whether PCM resampling/quantization is allowed. ALSA plugin-layer
automatic conversion is disabled in both modes.

1. Probe and decode the first valid frame to obtain the source rate, channel layout, sample
   representation, effective bits, and their confidence.
2. Generate a finite set of candidate formats from the source type, strictly preserving rate and
   channel semantics.
3. For each candidate, constrain format/rate/channels/access jointly, then set period/buffer;
   separately queried support lists must not be treated as if every combination were supported.
4. Use exact rate settings and disable ALSA automatic rate/channel/format conversion; period/buffer
   may be adjusted within the range the device allows. If the API uses near, the resulting rate must
   be verified to be exactly identical, otherwise fail.
5. After submitting hw/sw params, read back the actual configuration and effective bits. Writing
   starts only after all key fields pass validation.
6. A source format change during playback must stop the old configuration and renegotiate; new
   frames must not continue to be interpreted under the old format.

Actual decoding accepts only the three sample representations `Signed16`/`Signed32`/`Float32`
(`direct_pcm.rs:18-22`); `AV_SAMPLE_FMT_U8`/`U8P` `bail` directly at the strict reader probe
(`direct_pcm.rs:244`), and there is no U8 bias-removal bit-widening implementation anywhere in the
repository. 20/24-bit must distinguish effective bits from storage bits. Sources beyond that integer
range are explicitly unsupported and are not silently truncated to 32-bit.

The PCM transport implements at least `S16_LE`, `S24_3LE`, `S24_LE`, and `S32_LE`; the corresponding
float format may be used as-is when the device supports it. Prefer the integer format that needs no
extra reordering and is sufficiently exact, then try other lossless representations; do not
permanently fix on some rate, stereo, or 32-bit output just to avoid reopening the format.

Integer adaptation uses explicit arithmetic and byte packing, not a generic float cast: if the
effective N-bit sample value is x and the target format's numeric width is M, scale exactly to
`x × 2^(M-N)` at that format's effective-bit positions, using a wide enough intermediate integer to
prevent overflow. Effective samples already left-aligned in FFmpeg must first be interpreted
according to their known representation and must not be shifted left again. The 24 numeric bits of
`S24_LE` are in the low three bytes of the 32-bit storage slot; the numeric bit width of `S32_LE` is
32, and the two must not be interchanged merely because both occupy 4 bytes.
[ALSA PCM format description](https://www.alsa-project.org/alsa-doc/alsa-lib/pcm.html)

The device `sbits` must be enough to preserve the source's effective bits; for example, when an S32
slot reports only 24 effective bits, a 24-bit source can be output with correct alignment, while a
32-bit source must fail. When the effective bits are unknown, do not scan the whole track to guess:
conservatively require the source at the full width of the decoded representation, and if the device
cannot confirm its precision the strict path fails with a specific reason.
[ALSA hardware parameters](https://www.alsa-project.org/alsa-doc/alsa-lib/group___p_c_m___h_w___params.html)

### 4.3 The single adaptation point for lossy and float PCM

This section specifies the minimal representation adaptation for lossy/float under direct; processed
separately goes through the selected DSP graph, and final integer packing reuses the same tooling,
so quantization/gain must not be applied twice.

Lossy decode results may be float/planar; FFmpeg does not represent PCM with a separate 24-bit C
sample type, and float samples may exceed the full-scale range. The current strict frame structure,
which accepts only S16/S32, cannot simply be applied to all sources.
[FFmpeg sample format description](https://ffmpeg.org/doxygen/trunk/group__lavu__sampfmts.html)

The lossy/float adapter interleaves channels on the producer thread and writes the negotiated output
representation. Prefer keeping the decoder sample representation; when the hardware accepts only
integers, choose the highest trusted effective precision for that rate/channel and perform one
deterministic quantization. Float-to-B-bit signed integer conversion uses wide enough computation,
explicit round-to-nearest-ties-even, and full-scale saturation; NaN/Infinity are treated as bad
input. This must not be used to introduce a 0.98 limiter, dynamic gain, dithering, or whole-segment
peak normalization. Record whether quantization/saturation occurred, for diagnostics and output
status display, without per-sample logging on the hot path.

An integer lossy decode result is transmitted exactly when the hardware bit width is sufficient;
when the bit width is insufficient, the same identified lossy adapter may perform one deterministic
quantization. This allowance can only be decided by the actual source category; a lossless source
must not be downgraded into the lossy path when the hardware does not support it. Float files also
explicitly belong to adapted output and do not masquerade as exact integer passthrough.

ALSA lossy support does not extend Diretta's acceptance range: Diretta keeps its existing strict
Source Direct rules and does not automatically borrow this quantization adapter; UPnP still follows
its own original-byte/strict extraction rules.

### 4.4 Channels

Direct preserves the mono/stereo/multichannel PCM that can currently be expressed exactly; the
target hardware must support the same channel count and a determinable channel mapping, without
duplicating mono, downmixing, or adding extra channels. processed currently exposes only
mono/stereo: `ffmpeg_audio 0.3.1` cannot explicitly pass an arbitrary source `AVChannelLayout`
through its public API, so `channels > 2` is explicitly rejected on the processing path, and layout
consistency must not be claimed merely because `channels == channels`. SACD keeps the currently
supported stereo area and does not use this to widen the SACD multichannel scope.

### 4.5 Native DSD

Support the combinations the device actually accepts among ALSA `DSD_U8`, `DSD_U16_LE/BE`, and
`DSD_U32_LE/BE`. These are independent DSD formats; data must not be written into an integer PCM
format of the same width to fake native.
[Linux ALSA format definitions](https://github.com/torvalds/linux/blob/master/include/uapi/sound/asound.h)

Record the per-channel DSD bit rate R and the number of bits W carried per ALSA frame/channel
separately; the ALSA configured rate is `R / W`. For example, DSD64 under U32 is 88,200 frame/s and
under U8 is 352,800 frame/s; Web still displays DSD64/2.8224 MHz, progress is computed from played
logical bits/R, and it must not be mislabeled as PCM 88.2 kHz.

Container bit order, word endianness, and channel interleaving are adapted separately, and the
mapping is constrained jointly by the format definitions and known bit-order tests. `_LE/_BE` must
not be treated as a DSF LSB/MSB bit-order switch. Reader output is separated from transport packing:
ALSA does not inherit the Diretta `DSD_SIZ_32` limitation, and Diretta keeps its own 32-bit wire
constraint.

The start and end of each source/track split must be fully expressed in the chosen W; try narrower
device formats first. When exact expression is still impossible, reject that combination rather than
truncating the trailing bits or fabricating silence to pad it out. seek may land on the nearest
legal device frame and report the actual position; this is a different requirement from not silently
moving the exact boundaries defined by CUE tracks.

### 4.6 PCM processing mode

processed preserves the existing software volume/mute, EQ/preamp, ReplayGain/loudness normalization,
fade, tempo, pitch, and pitch-sync. Disabled effects are bypassed, and user parameters are not
rewritten because playback resumed. A new explicit "clipping protection" switch takes over the
former limiter; when it is off, only the necessary full-scale saturation is done at the final
integer conversion, with no implicit dynamic limiting retained. Both new installs and migrated old
configurations enable this protection by default; the UI/runtime state clearly shows it, and the
user may turn it off.

The processing order is fixed: source decode and track-split trimming → float/known channel
arrangement → normalization or ReplayGain → EQ/preamp → tempo/pitch → necessary output rate
adaptation → software volume/mute and fade → optional clipping protection → final format conversion
→ the single ALSA writer. When normalization has valid ReplayGain, use only the corresponding fixed
gain, otherwise use the existing loudness analysis; the two gains must not be stacked. Volume and
fade are applied only once.

Prefer the source rate; when the hardware does not support it, processed may use a rate the device
offers under the same channel layout, preferring the device's preferred rate, otherwise choosing
from the available discrete candidates by the rule of closest to the source rate and, at equal
distance, the higher rate. That choice must be reflected explicitly in source/device state and is
not called original-sample-rate passthrough; direct does not use this policy. Output selection may
quantize to the actual hardware precision, still without hiding conversion behind ALSA plug.

All instances are configured by the source/device rate and the real channel count; when a
multichannel algorithm is unsupported, report an error explicitly rather than processing only the
first two channels or silently downmixing. Parameter updates take effect at DSP block boundaries,
and Core/player locks are not acquired during per-sample processing; no parameter version is exposed
externally today, so no version protocol is added for it. Track switching, seek, and reopening reset
the effect history they own; EOF correctly drains the tempo/resampler tail and keeps its necessary
state until valid output is fully drained.

Continuous playback in the same format may reuse the stream and the processing state that needs to
run continuously, but normalization's per-track gain and metadata switch at the corresponding sample
boundary. fade is used only for the existing start/stop behavior and adds no crossmix; an urgent
stop/cancel still drops immediately. Real-time parameter updates do not change the mode: processed
stays processed when all effects are off, and does not dynamically upgrade to passthrough.

processed does not support Native DSD. When playing DSD or attempting to switch playing DSD to
processed, Core rejects before destroying the old runtime with "Native DSD requires exact
passthrough mode"; it does not automatically convert to PCM, change mode, ignore DSP and keep
playing, or send Native DSD under the PCM processing label.

The public resampler configuration of `ffmpeg_audio 0.3.1` exposes only the target channel count and
internally generates a default channel layout for the target side. mono/stereo can therefore be
accepted directly; arbitrary multichannel cannot claim semantic preservation merely by channel count
before the source `AVChannelLayout` is explicitly preserved. The implementation must not hide this
limitation behind "channels are equal". The current implementation explicitly rejects processed
`channels > 2`; Direct can still negotiate multichannel according to exact transport capability.
Only after the explicit layout API/handling is completed may processed multichannel be enabled.

## 5. Device identity, opening, and buffering

Continue to use `AudioDevice` and `alsa:hw:CARD=<id>,DEV=<n>`, enumerating real playback PCMs from
the ALSA control interface. After parsing, open with a controlled HW configuration and verify the
PCM type/device information, so as to avoid checking only the name prefix while actually opening a
plug/softvol alias from the user configuration. ALSA officially defines HW as a plugin that accesses
the kernel directly without conversion.
[ALSA HW plugin](https://www.alsa-project.org/alsa-doc/alsa-lib/pcm_plugins.html)

Do not persist a card index that changes with enumeration. Keep using the named card ID, but do not
exaggerate it into a permanently unique USB hardware serial number; when names collide or identity
is ambiguous, require reselection and do not silently pick the first device with the same name. The
display name is for presentation only, and an old name is migrated only on a unique match. Old
`default`/`plughw` selections become invalid and keep the no-output-selected state.

`outputDevice = null` means nothing is selected. The original plan to "delete the 'system default'
comment and behavior" is **not landed**: the "null means system default" comment in
`shared/types/settings.ts:51` is still there, and `src/web/HeadlessApp.vue:268` still renders
`<option value="">系统默认</option>`. Keep the existing rule that auto-selects only when there is
exactly one unique HW candidate at first startup; after a selected device is lost, the
first-selection logic must not be reused to switch to another device. ALSA `isDefault` no longer
means the desktop default and returns false. Refreshing the device list must not pause/reopen the
current audio device.

Use direct `alsa-lib` calls, preferring the Rust `alsa` crate; add local FFI only where bindings are
missing. `RW_INTERLEAVED + nonblocking writei + poll` is the baseline of this plan. A dedicated
thread holds the PCM handle and control commands are delivered through a bounded channel and a
wakeup fd; the Node thread and the writer must not call the same PCM handle at the same time.

The initial scheduling parameters are about a 10 ms period and about a 100 ms hardware buffer,
negotiated within the device's actual range with the result recorded; these are buffering targets,
not mandatory format conditions. The producer ring is preallocated from the negotiated buffer and
the maximum frame block, with caps on frame count and byte count; it is rebuilt in the control phase
when the format changes, not grown inside the writer. By default no "audio quality tuning" switch is
exposed, and a change of scheduling parameters must not change the source rate.

Explicitly start after the existing prebuffer is sufficient; files shorter than the buffer
start/drain by their real length and must not wait forever for a high watermark. Disable the
application-controllable silence insertion, and let a normal underrun turn into an error; do not
rely on ALSA's automatic silence padding to fake continuous output. Start threshold, stop threshold,
silence, and drain behavior must be set explicitly and read back.
[ALSA software parameters](https://www.alsa-project.org/alsa-doc/alsa-lib/group___p_c_m___s_w___params.html)

## 6. Buffer ownership, playback progress, and lifecycle

### 6.1 The Diretta callback protocol cannot be reused as-is

The existing Direct ring's `next_block()` releases the previous block, `release_in_flight()`
accumulates consumed frames per whole block, and the track boundary switches when a block is taken.
ALSA `writei` may accept only part of a block, and an already submitted block may still be waiting
in the kernel buffer to play. These two semantics must be separated.

- Extract a safe Rust consumer API from the existing ring: acquire a block lease, read a read-only
  view, and return it explicitly; the Diretta C callback is a thin adapter over it and does not
  drive ALSA through `*mut c_void`.
- The lease guarantees the producer does not overwrite the current block before it is fully written;
  the ALSA writer keeps a frame offset, and a short write advances only the actually accepted count.
  Before cancellation, first make the writer stop referencing the block, then return/destroy it;
  dangling references across generations are forbidden.
- Integer pack / DSD bit-order adaptation / float quantization are completed in the producer or a
  bounded preparation stage. The writer only waits, submits prepared data, advances counters, and
  handles lightweight commands; it does not decode, allocate, acquire the player's big lock, or do
  discovery and logging I/O.
- processed's DSP and fade are also executed only in the producer; blocks carry media time and
  track-boundary mapping. The lock that stores DSP parameters must not be brought into the writer;
  the bounded preprocessing amount also bounds parameter effective latency.
- Releasing a ring slot only means the memory can be reused; it must not simultaneously be
  interpreted as having been played by the DAC.
- `Pending`, real EOF, decode failure, and cancellation must be different results; `None` must not
  carry all of these semantics at once.

### 6.2 Time and track boundaries

The ALSA transport maintains submitted frames, device delay, and the played estimate separately. In
the normal state `played = submitted - delay`, constrained to the legal range by device state;
negative values and invalid delay after an XRUN cannot be forced into the formula. direct's PCM
position is converted by source rate; DSD by logical bit rate. processed must also map to media time
through each output block's source frame range, tempo segments, and processing latency, and must not
simply use `played / outputRate` as the song progress, nor back-compute the whole history from the
latest speed. The position includes both the seek base and the track start, and seek/reopen/mode
switch establish a new time epoch.

The track generation and boundary records brought in by staging are placed on the output timeline.
`directTrackBoundary` / `processedTrackBoundary` are published to Core only when the played position
crosses the boundary; lyrics/statistics must not be switched early when the next track is read, when
the decoder completes handoff, or when data is written to the kernel. A very short track may cross
several boundaries within one polling cycle, so bounded boundary records must be consumed one by
one, not by reusing "the last generation". Core still decides the next track, and native only
accepts staging that Core has prepared; a late old generation can only be discarded and must not
resurrect a cancelled next track.

Decode EOF, an empty ring, and device drain completion are three different stages. `Ended` is sent
once only after real EOF and after all valid samples have finished draining. Truncation/decode
failure must not be covered up by the old chain's "treat as a normal ending" tolerance even when it
happens within the last 3 seconds of a track.

processed also has an effective tail-drain stage for tempo/resampler in between; the end event and
track boundaries must account for processing latency. The current UI does not declare that a given
parameter update has taken effect on the DAC side; quantization/protection and similar information
must not incorrectly inherit the previous track's diagnostics. Statistics are still computed from
media time and the actual playback state.

### 6.3 Operation semantics

| Operation                 | Behavior that must be implemented                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| load                      | Probe/prepare the source, cancel expired tasks, stop and release the old output, open/prebuffer the new output; check the token before commit                                                                            |
| play                      | Start the prepared configuration; direct bypasses DSP, processed executes the start/stop envelope with the confirmed parameters without rewriting saved values                                                           |
| pause/resume              | First run the start/stop envelope the mode allows; hardware pause keeps the queue, otherwise stop new writes and pause after draining, keeping unwritten blocks for resume; direct does not fade                         |
| seek                      | Stop referencing old blocks, drop old buffers, flush the decoder and locate exactly; after prebuffering resume the original playback intent; return the actual position                                                  |
| stop                      | Immediately cancel producer/staging and drop device buffers; can wake blocked waits and does not wait for a whole-track drain                                                                                            |
| same-format gapless       | Share the PCM handle; Direct requires wire-format compatibility; processed reuses the same decoder/DSP/writer runtime, prebuilds the next decoder for the current output format, and uses DAC-side time/boundary mapping |
| cross-format track switch | Drain the effective tail of the path involved and renegotiate; direct does not resample, processed adapts only per the explicit policy; neither switches mode automatically                                              |
| output switch             | Complete target preparation as much as possible first; when committing the switch, stop the old output before opening the new one; there is always only one active output                                                |
| switch failure            | Explicitly report that the selected target is unavailable and stay stopped/paused; do not silently restore the old device or switch to the default device                                                                |
| device hot-plug           | The writer reports a device error and releases resources; refreshing the list/user retry may reopen the same explicit endpoint                                                                                           |
| SIGTERM/restart           | Send cancel and wake the writer, wait for exit within a bounded time, clean up this process's temporary resources; do not join while holding a lock on the main thread                                                   |

On devices without hardware pause, pause waits for the currently submitted buffer to finish playing,
with a delay of about the actual pending buffer duration; the UI shows paused only after receiving
the completion event. This wait applies only to already submitted data, can be cancelled by
stop/seek/a new load, and is bounded by the drain timeout. The estimated position must not be read
and then dropped while claiming the not-yet-played samples can be resumed without error; there is a
race between observing the device pointer and the drop. During pause the source/output format and
unwritten data are kept, and the producer is bounded by backpressure; stop and output switching are
responsible for releasing the hardware.

Lossy gapless must correctly handle the decoder's encoder delay/padding/skip-samples metadata and
guarantee it is trimmed only once; seek playback positioning uses the same time base. Sources
without such metadata are not promised to have the gaps inherent to the encoding removed.

The first version of processed gapless is enabled only when the generic next-track preload is
already enabled, the current tempo/pitch is bypass, and the next track is an ordinary mono/stereo
PCM decoded source. CUE, SACD/Native DSD, and channel-count changes do not use staged handoff and
continue through the existing `Ended -> load`; a source sample-rate change can be handled by
processed's existing output rate adaptation, so the two tracks are not required to have the same
original rate. If speed/pitch becomes non-bypass during preload, the staged next track must be
cancelled immediately, and the stretch internal window must not cross the track boundary. A staging
failure, late arrival, or cancellation only loses the gapless optimization; it must not block an
explicit user load/seek/stop or change the canonical queue.

### 6.4 CUE, SACD, and exact positioning

CUE continues to be passed by Core as original 75fps integer boundaries; native maps the boundary to
source sample frames in one step, using the existing unified rounding rule and the `[start, end)`
interval. Adjacent tracks share the same boundary value and are not measured separately with float
milliseconds, avoiding a duplicated or missing frame; when the mapping cannot fall exactly on a time
point, the unified sample boundary is explicitly adopted, and no time resolution beyond the source
sampling precision is claimed.

FFmpeg seek only locates the decoder to a recoverable packet/frame; continue decoding and exactly
discard valid samples before the target, and do not treat the coarse-grained packet seek as the
final playback position. EOF, encoder delay, and CUE truncation share the same effective sample
coordinate, and the actual position is converted to milliseconds at the Core boundary. SACD reuses
the existing track reader/DST decompression and does not materialize to PCM first; DSD track
splitting then verifies the transport alignment of section 4.5.

## 7. Error and recovery strategy

**Status (2026-09-23 review)**: Core `ErrorCode` already has stable reasons (such as
`OUTPUT_FORMAT_UNSUPPORTED`), but native `AudioErrorKind` has only six categories —
NetworkUnreachable, SourceNotFound, DecodeFailed, Device, Cancelled, Other (`error.rs:11-19`) — with
no "mode conflict" category; direct's mode rejection is still given by an `anyhow::bail!` string
(`player/mod.rs:389-396`). Adding the necessary stable reasons on the native side and not judging by
string keywords is a **not-landed goal**. Continue to use the current error event/response envelope
and expose only stable reasons and safe format information to Core/Web; the output generation used
to retire old callbacks stays internal to native/Core and does not become protocol state.

| Situation                                   | Behavior                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EAGAIN`, retryable `EINTR`, short write    | The writer polls/continues the unwritten part; do not drop blocks, write twice, or generate silence                                                                                         |
| rate/channel/format/sbits mismatch          | `OUTPUT_FORMAT_UNSUPPORTED` (`shared/types/errors.ts:61`), stop that load, and show the source/device mismatch                                                                              |
| Device missing/busy/insufficient permission | Device-class error, stop; do not treat it as an invalid URL or skip tracks indefinitely                                                                                                     |
| XRUN                                        | direct immediately judges this continuous passthrough as failed; processed does at most one bounded recover, explicitly records the discontinuity, and reports a device error if that fails |
| suspend, device failure during operation    | Stop the current runtime and report a device-class reason                                                                                                                                   |
| Bad source/decode failure                   | Source-class error; Core reuses the existing bounded re-resolve/skip policy                                                                                                                 |
| Network materialization failure             | Core handles it as a network/source reason and does not create an ALSA stream to mask the download failure                                                                                  |
| A new load/seek/stop supersedes an old task | Normal cancellation; the old task no longer submits state, errors, or end events                                                                                                            |

Device format/bit depth unsupported stops by default with a prompt and does not automatically work
around a failure of the playback the user just selected with another track.
`outputFailed`/`outputStalled` no longer enter an automatic `requestReinit()`; deterministic format
failure, Direct XRUN, device disappearance/occupancy, etc. are projected by Core into an explicitly
recoverable paused state that waits for user action. native no longer owns the `reinitOutput()`
source-reload state machine; explicit `/player/reinit` is also executed by the Core playback session
as a normal load/seek/play lifecycle using the authoritative Track, position, and playback intent.

The processed writer allows one local, synchronous, bounded ALSA recover: on success it opens a new
hardware time epoch and records the interruption as a discontinuity without claiming seamless
continuity; if the same write fails again or the recover fails, it immediately reports
`outputFailed`. direct does not do a transparent recover, because once an XRUN occurs the continuous
bitstream guarantee is already void.

There is no hidden native retry/skip loop; Core and native each handle only their own layer,
avoiding both rebuilding at the same time.

## 8. Core sources, preload, and cache

Continue to use `playbackSourceResolver.ts`, `playerLoad.ts`, `playbackPreloader.ts`,
`directGapless.ts`, the existing provider/DASH materialization, and `exactInput.ts`; do not create a
new ALSA downloader.

This round of implementation adopts the existing Direct's full local seekable input contract: an
online finite track is first fully materialized into original bytes or hits a complete cache, and
only then native-loaded; the next track is prepared by Core. FM is still a finite Track queue
provided by Core. This is a first-play latency tradeoff accepted in order to reduce ALSA lifecycle
refactoring variables, not a permanent precondition of the ALSA transport or of direct completeness.
The UI shows that the source is being prepared, and cancellation must take effect promptly.

Unbounded live streams/progressive HTTP readers are not part of this round's input contract, and
pretending to support them by always waiting for EOF is not acceptable. If a Core-owned seekable
streaming implementation is added in the future, it may replace the "materialize fully then load"
input implementation as long as it can provide exact original bytes, explicit EOF, cancellable
reads, bounded caching, and seek/range semantics that satisfy the decoder; that does not require
changing the ALSA direct/processed mode boundaries, and must not revive the CPAL output or the old
thread orchestration. An unknown Content-Length is not by itself equivalent to a live stream and
should be handled together with source capability and timeout/size constraints.

Along with reuse, the following resource constraints must be completed:

- Use a shared helper to express native source-preparation capability, replacing the `diretta:`
  checks that genuinely represent that capability; SDK discovery, root checks, and Target
  negotiation remain Diretta-specific.
- Prefer reusing song caches and files already materialized by the resolver, and deduplicate
  concurrent preparation of the same URL/Track; provider credentials and resolution stay in Core.
  The actual codec is probed from the content and does not rely on the temporary file suffix.
- Temporary paths are managed through Core's unified path helper. The process `/tmp` directory and
  `pruneDirectInputs(keepPath)` in the current `directInput.ts` need adjustment: protect current,
  staged, in-flight, and switching files, and do not delete the next track in order to clean up
  files other than the current one.
- Temporary caches define a byte cap, expiry cleanup, crash-leftover cleanup, and reference
  lifetime; only files owned by this module with no references may be reclaimed, and user local
  sources or the persistent song cache must not be deleted by mistake. Insufficient space fails
  explicitly.
- stop/track change cancels downloads no longer needed this time; a deduplicated task still
  referenced by another valid preparation must not be cancelled.
- `.part` atomic completion, non-empty/response integrity, timeout, and total size limits are
  verified together. A non-zero file length alone is not enough to prove the source is complete; do
  not tolerate truncation after strict EOF. Diagnostic logs do not output the provider's final
  credential-bearing URL.
- Core only stages the next track that has been selected; cancellation/queue changes invalidate the
  old staging generation. A same-format candidate preparation failure must not interrupt the current
  track; after the boundary Core handles it per the existing policy.

Do not fall back all exact decoding to the old HTTP→f32 path just to keep a streaming first-play
experience. Adopting full local input in this round also does not mean materialization must be
permanent in the future, still less that HTTP/FFmpeg dependencies still needed by other non-playback
features may be deleted.

## 9. Mode, control protocol, Web, and configuration migration

### 9.1 Core mode and parameter authority

Add `alsaPlaybackMode: "direct" | "processed"` to `PlayerSettings`, representing only the
ALSA-confirmed mode preference; switching to Diretta/UPnP does not overwrite it. Continue to use the
existing volume/EQ/normalization/fade configuration to save processed parameters; reuse the existing
speed/pitch state, and do not add another duplicated set of settings for the dual mode. Transient
parameters that need to be restored across modes are held by Core and must not live only in Web
localStorage.

Saved parameters and effective parameters are separated: direct's software gain is always unity,
speed is always 1, and no effect takes effect; processed restores the saved configuration. Entering
direct does not require first clearing EQ presets or rewriting the stored volume to 100%. native
receives only the execution configuration available in the current mode and still validates
strictly; this is not letting one set of DSP instances "claim bypass" while carrying old parameters.
When updating the Diretta preflight, also distinguish the saved processed configuration from the
actually active processing graph; Diretta's unity/no-DSP constraint is unchanged and should not be
wrongly blocked by a dormant configuration.

Core provides an explicit mode-switch command through the existing HTTP/WS command channel (for
example `POST /player/alsa-mode`) and does not change mode directly through a generic settings
write. A generic settings entry point must route to the same switch transaction. Mode switching,
output switching, and load/seek continue to reuse the existing serial coordination, load token, and
output generation; these identifiers stay entirely inside Core/native and are only responsible for
retiring old async results and old events, not for entering HTTP/WS state or ordinary control
requests. DSP parameter commands only need to check the actually current output path at execution
time; Web cannot write Pinia first and expect native to catch up afterwards.

### 9.2 Runtime state, control capability, and markers

Add a unified `output` runtime-state projection to the existing `PlayerStatus` and use it for the
HTTP snapshot and WS status. The runtime state stores only the current facts the control plane
genuinely needs; the persisted ALSA preference continues to exist only in
`PlayerSettings.alsaPlaybackMode`, and mode is not copied again in output status. The current
structure stays minimal:

```text
deviceId: string | null
path: exact-pcm | native-dsd | decoded-pcm | processed-pcm | null
sampleProcessingAvailable: boolean
```

`path` is the single runtime fact of the current playback chain: `exact-pcm`, `native-dsd`, and
`decoded-pcm` belong to the direct path, `processed-pcm` belongs to the processed path; it is null
when no runtime has been committed. Which path ALSA should use next reads only
`PlayerSettings.alsaPlaybackMode`; Diretta/UPnP do not read it as their own state. The mode-switch
target is only a parameter of the command being executed and does not enter long-term status.

`sampleProcessingAvailable` is derived purely on each snapshot from the actual `path`, the current
native ALSA mode, and the output identity, and does not store a second copy of controls/mode state.
It is true for an active `processed-pcm`; with no runtime it is true only when the currently and
explicitly selected output is ALSA HW and native has committed mode=processed; Direct, Diretta, and
UPnP are all false. The mode switch's `stop()` and the native mode commit are in the same
synchronous section, so no extra `preparing` state is needed to block DSP commands; an external
command only needs to read that capability again when Core executes it.

source/device format, quantization/resampling, clipping, XRUN/discontinuity, etc. are diagnostic or
real-device acceptance information and are not kept resident in PlayerStatus for the sake of
"complete state". Read them from native diagnostics, logs, or dedicated tests when needed; do not
add another set of `source/device/adaptation/processing/clipped/integrity` canonical state.

The mode selector is used for operation, and the actual path information stays in the output details
opened on demand. The main playback UI adds no status text or badge by default; if a small icon is
kept, its semantics follow the actual path, and the mode preference is not used as the current audio
guarantee.

If a passthrough icon is added later, it may only be judged directly from the actual `path`:
`exact-pcm`/`native-dsd` may express the current passthrough path, and `processed-pcm` must never
show it; merely selecting `direct`, a lossless file label, or a device being `hw` are not sufficient
conditions. The current UI does not require storing an extra `integrity` field.

Core submits the minimal runtime facts and derived capabilities in the same snapshot, and Web
projects them uniformly to all components; it must not maintain a second authority field by field.
HTTP/WS command returns only indicate command acceptance or failure and carry no extra state version
that would let Web overwrite the snapshot in reverse. Old native results are retired by
Core/native-internal token/generation.

### 9.3 Mode switch transaction

1. The user explicitly selects the target in the ALSA mode selector; the target mode is only a
   parameter of the current command, is not written into PlayerStatus in advance, and does not add a
   global `preparing` state.
2. Core checks the current target output and source type during serial playback coordination, saves
   the source media position, playback intent, and processed parameters, and invalidates the old
   staging. Deterministic unsupported cases such as DSD→processed are rejected before releasing the
   old runtime; after rejection it publishes the unchanged actual path and operability, and must not
   keep a fake marker of the pending mode.
3. Prepare the new path, stop the old producer/writer, discard the old mode's device buffers, and
   rebuild using the same ALSA backend. When switching from a processing mode to direct, first
   confirm that old DSP output is no longer stranded in the ALSA buffer; do not just flip a UI
   switch.
4. Only after the new runtime validates, prebuffers, and commits successfully is the ALSA preference
   updated; subsequent status snapshots directly reflect the new path/capability. The existing load
   token/output generation inside Core/native guarantees that old loads/events cannot come back to
   life afterwards. On failure the target preference is not committed; if the old output has already
   been released, stay stopped and clear path, and do not automatically return to the old mode or
   the default device.
5. direct→processed uses the saved parameters and resumes per the original playback intent;
   processed→direct, to avoid going from software attenuation/mute straight to full scale, uniformly
   stays paused after the switch. The selector shows in advance "pauses after switching, volume is
   adjusted by the external device"; the user continues with a normal Play click, without another
   confirmation wizard.

With no source loaded, only the Core/native mode preference is committed, and hardware is not opened
or a current path faked just to switch modes; the next load instantiates per that preference. An
idle parameter change in processed only updates Core's saved configuration and does not create a
background DSP thread that nobody consumes.

A mode switch on the same device must also go through this transaction. Output switches that enter
Diretta, where software gain goes from attenuated to unity, follow the same pause semantics.
stop/seek/rapid repeated switching may cancel an expired transaction; an ordinary pause/resume does
not switch modes automatically. The staging/playback-preparation key includes the output, mode, and
versions that affect processing compatibility, and must not consume a processed preload from the old
mode. The original-byte song cache/materialized files are still shared by source and are not
downloaded or copied again because of a different mode.

### 9.4 Adaptive changes to the existing UI

Reuse the current components and adjust the data sources and entry points; do not build a separate
player page. Presentation follows the principle of low interference:

- The main playback UI adds no persistent chain-status text by default, and does not require a
  status marker at all.
- If a status entry point is needed, reuse the existing output button or a small static icon, and
  add no whole-line explanation, prominent badge, blinking animation, or per-track-switch
  notification. Do not add a "show status" setting to shift the design burden.
- If the icon has a specific meaning, provide a short tooltip and an accessible name, for example
  "passthrough"; tapping on a touch screen may open the output details. The icon must not imply
  end-to-end verification that has not been obtained. A pure device entry icon does not mean
  bit-perfect.
- The mode selector still clearly distinguishes the two modes; PCM/DSD, source/device format,
  processing items, and guarantee scope are shown only when the user actively opens the details or
  explanation, and are not expanded automatically into the playback area.

The behavior in each place is as follows:

| UI location                                                            | direct / passthrough output                                                                                                                                | processed                                                                                                | Switching, disconnected, or unknown                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Output selector, playback settings                                     | ALSA offers the "exact passthrough / PCM processing" choice; explain the lossy exception                                                                   | Show the confirmed processing mode and the same HW device                                                | Show switching/connection state and do not treat the requested mode as success                                                 |
| Toolbar software volume and mute                                       | Remove the actionable volume slider/mute; when needed, note the external adjustment in an icon tooltip or in settings, without persistent explanatory text | Keep the slider, mute, and actual software volume                                                        | Disable the controls and do not accept wheel, key, or drag commits                                                             |
| EQ/tempo/pitch shortcuts                                               | Disable and explain "available after switching to PCM processing mode", without offering adjustable parameters                                             | Keep the existing entry points and dialogs                                                               | Lock; dialogs already open switch to non-editable in sync                                                                      |
| Playback settings normalization, ReplayGain, fade, clipping protection | Hide the editable area and keep an unavailable explanation; do not show a stored switch as currently effective                                             | Show and bind to Core parameters/effective state                                                         | Lock; read back the complete state after a failure                                                                             |
| Player output marker/details                                           | Not marked by default; an optional small icon appears only when the guarantee is actually met, with details viewed on demand                               | Unmarked, or only a neutral output entry; no passthrough icon, with processing items left in the details | Clear the old guarantee icon; switch feedback is limited to where the user acted and is not a persistent technical explanation |
| Source quality selection, track Hi-Res/lossless labels                 | Keep the source-quality meaning and present it separately from the output chain                                                                            | Same as left; a lossless source through DSP still cannot show output passthrough                         | Do not infer the output state from source labels                                                                               |

Specific locations:

- `src/core/player/directMode.ts`: change it into a unified mode/capability helper that consumes the
  Core output projection; replace the logic that judges DSP capability only by `isDirettaOutput()`
  or `isSampleProcessingUnavailableOutput(deviceId)`. The shared device namespace helper is still
  kept for identity and does not carry mode authority.
- `src/web/OutputDeviceSelector.vue` and the settings `DeviceSelector.vue`: share the same
  mode-selection component/command, and only ALSA shows the two options; Diretta/UPnP show their
  respective fixed behavior, with no available DSP mode.
- `src/components/player/Toolbar.vue`: cover volume, mute, wheel, and the EQ/speed entry points,
  remove the persistent display that hardcodes passthrough as "Diretta Source Direct", and either
  omit the status or reuse the small icon per the rules above, rather than replacing it with
  another, longer string of technical terms.
- `src/components/modals/EqualizerDialog.vue`, `SpeedDialog.vue`: when the capability becomes
  unavailable, immediately cancel uncommitted drag/debounce requests and disable the controls; an
  already open dialog shows an unavailable explanation. Old parameters must not be committed after
  the dialog is closed.
- `src/settings/categories/player.ts`, `DirectModeNotice.vue`: keep the DSP settings, hide/lock and
  prompt according to capability, and show the difference between saved and effective state; remove
  the old notice that "a dormant EQ configuration blocks entering passthrough".
- `src/components/player/QualityControl.vue` and quality details: source quality does not share a
  judgment with the passthrough badge; playing FLAC/Hi-Res in processed is a dedicated acceptance
  case.
- `src/core/player/index.ts`, generic settings submission, shortcuts/wheel/media keys: use the same
  capability check, not just modifying the visible buttons; keep the Chinese and English copy,
  mobile/fullscreen, and multi-client views consistent.

### 9.5 Command guard and save behavior

Keep the existing HTTP/WS, plugin, and N-API capabilities for DSP/software volume, migrated to the
processed producer. Any sample-processing modification checks the same `sampleProcessingAvailable`
derived capability when Core executes it, and native remains the last line of defense for Direct;
under the direct path, no matter whether the user sets the volume to 1 or 0, the command explicitly
returns `output_processing_unavailable` (HTTP 409, `core/atom/headless/routes.ts:133`; the internal
throw in `core/services/playbackSession.ts:1864` uses the text `processing_unavailable`), without
changing saved parameters or secretly switching modes. With no active runtime, dormant parameters
may be edited only when the ALSA preference is processed. Under passthrough, the constraint likewise
must not be bypassed through the generic settings API, an EQ reset, or a keyboard shortcut.

No state version or CAS is added for ordinary parameter commands such as volume, EQ, and tempo. When
multiple clients operate at the same time, Core's actual execution order prevails; if an earlier
command has already switched the output or path, the later command fails at execution time because
the current capability does not allow it. Plugin and generic settings entry points go through this
same real-time check. Core/native's last validation is independent of Web; it must not rely only on
a disabled button.

In processed, each parameter command is updated in Core execution order, and the DSP reads the
current value at the next block boundary; intermediate states between different commands are
allowed, and no snapshot or version mechanism is added for multi-parameter transactions that are not
provided. A failure must not leave only the checkbox in the UI. `volume=1` and `speed=1` in
passthrough/remote state mean no local gain/tempo change, do not overwrite the saved processed
parameters, and do not represent the DAC's actual volume. The processed state returns the currently
accepted settings and does not declare which specific frame has been applied on the DAC side.

Only the default-device/watcher and old-output-specific N-API interfaces are deleted; the DSP
setters/getters are kept with a modified implementation. Synchronously update the generated types,
protocol version/capability, error mapping, and plugin documentation; plugin failures go to
diagnostics and exceptions are not swallowed.

### 9.6 Upgrade behavior

Use the existing migration and deployment backup flow, preserving the DSP configuration, software
volume, EQ presets, and unrelated settings. When an existing installation lacks the mode field,
migrate the ALSA preference to processed to preserve the original volume/effect intent; the upgrade
must not default to direct and thereby disable software volume. Existing Diretta/UPnP selections are
unchanged, and only the not-yet-enabled ALSA preference is initialized.

New installs default to direct; a processed configuration that has not yet been enabled follows the
existing defaults. The old limiter behavior is taken over by the explicitly enabled processed
clipping protection. Existing valid HW IDs are kept, and default devices/ambiguous names enter the
unselected state. After migration, Core initialization constructs the processing path per mode and
does not first apply saved DSP to passthrough and then try to turn it off.

Switching to direct does not delete or reset the processed configuration; returning to processed
restores the original settings. Session restore, application restart, browser refresh, reconnect,
and output switching all read the same mode and configuration from Core, with no browser-private
second copy of mode state. A mode failure/incompletion must not be persisted as success.

## 10. File-level implementation work and dependencies

The following is the dependency order for completing the same goal, not a release batch, and later
items are not left as optional patches.

**Status (2026-09-23 review)**: the ALSA backend, the processed producer migration, the Core input
and failure policy, and the protocol and migration have landed; the planned
`pcm_decode.rs`/`pcm_processing.rs` file names were not adopted, and the work actually lives in
`media_probe.rs`, `direct_pcm.rs`, `alsa/processed_pcm.rs`, and `alsa/processed_prepare.rs`; "delete
the old implementation and its dedicated tests" is still incomplete (see the not-landed items in
section 2).

| Work                                                  | Main files                                                                                                                                                     | Completion requirement                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extract standalone probing/PCM decoding               | `decoder.rs`, `direct_pcm.rs`, `media_probe.rs` (landed; `pcm_decode.rs` not adopted)                                                                          | Probing does not depend on playback/DSP; the integer strict and lossy adaptation boundary is explicit                                                        |
| Migrate PCM DSP                                       | `alsa/processed_pcm.rs`, `alsa/processed_prepare.rs` (landed, the planned name `pcm_processing.rs` was not adopted), `equalizer.rs`, `loudness.rs`, `tempo.rs` | Existing features take effect in processed and direct builds no processing graph; parameters, latency, tail, and time mapping are verifiable                 |
| Fix DSD reader boundaries                             | `direct_dsd.rs`, `diretta/`                                                                                                                                    | The shared logical sequence is decoupled from transport grouping; the Diretta sample/bit-order evidence regression passes                                    |
| Implement the ALSA backend                            | new `alsa/`, Cargo manifests/lock                                                                                                                              | Exact parameters, integer packing, lossy adaptation, Native DSD, short writes, and a cancellable writer are all available                                    |
| Merge the native lifecycle                            | `playback.rs`, `direct_runtime.rs`, `player/*`, N-API `bindings/player.rs` (not landed: `direct_runtime.rs` not deleted)                                       | A single runtime; progress/drain/boundary/cancellation semantics pass tests                                                                                  |
| Wire in Core input and failure policy                 | `playerLoad.ts`, `playbackPreloader.ts`, `directGapless.ts`, `playbackSession.ts`, `device.ts`, `corePlayerEvents.ts`                                          | Local/online/CUE/SACD/output switching are consistent; cache references are safe                                                                             |
| Protocol and migration                                | `shared/types/*`, `shared/utils/outputDevice.ts`, Core routes/WS/plugins/store                                                                                 | Mode transactions, parameter saving, and capability come from the same source; old configurations migrate to processed, and passthrough rejects DSP requests |
| Delete the old implementation and its dedicated tests | the files in section 2, native re-exports, Cargo/features                                                                                                      | Delete CPAL/the old thread orchestration/implicit processing, and keep and test the migrated DSP algorithms                                                  |
| Build and documentation sync                          | native build/staging, native flavor tests, AGENTS/native/deployment/hardware docs and their Chinese and English counterparts                                   | An ordinary build needs no SDK; Diretta SDK provenance is unchanged; documentation does not claim real-device evidence that has not been obtained            |

When deleting tests, delete only assertions for removed product behavior; tests that originally
verified cancellation, error classification, output mutual exclusion, track splitting, and provider
behavior must be migrated to the new implementation. Some tests currently match the CPAL feature and
source-code strings and need to be replaced with new dependency-constraint/behavior tests; do not
keep fake files and dead code just to make the old text-matching tests pass.

## 11. Verification and acceptance

### 11.1 Software sample evidence

- PCM uses zeros, positive/negative full scale, least significant bits, cross-byte boundaries,
  random samples, and distinct per-channel sequences, covering 8/16/20/24/32 effective bits and each
  output packing format. After normalization to the same effective-bit representation, samples must
  be strictly equal.
- Encoder/decoder sample comparison covers packed/planar for WAV/AIFF, FLAC, ALAC, APE, and WavPack,
  including start/end, seek, CUE, and gapless. Test expectation data must not be generated only by
  the inverse function of the packer under test.
- Lossy coverage includes real decodable fixtures for MP3/AAC/Vorbis/Opus, delay/padding, short
  files, and out-of-full-scale values; verify against the current fixed FFmpeg decode result and an
  independent quantization reference, without requiring equality with an original recording that
  does not exist.
- Native DSD uses an asymmetric bit pattern that differs per channel, covering DSF/DFF/SACD/DST, bit
  order, byte order, U8/U16/U32, group tails, seek, and CUE; compare bit by bit after unifying to
  the logical bit sequence.
- The fake writer injects continuous short writes, EAGAIN/EINTR, XRUN, suspend, device disconnect,
  stuck drain, and cancellation; verify that frames are neither duplicated nor missed, EOF is
  reported only once, no artificial silence is sent, and a stop can wake the thread; direct XRUN
  must fail, processed allows only one bounded recover and leaves a discontinuity, and must not
  recover in a loop or fake seamlessness.
- When an exact direct source is unsupported it does not enter the lossy adapter or processed; a
  lossy source does not trigger the exact integer marker; the Diretta and UPnP strict readers are
  unaffected by ALSA lossy support.
- Verify pause fallback, multiple very short track boundaries, format changes, rapid load/seek/stop,
  expired callbacks, current/staged file pinning, insufficient space, and download cancellation,
  with no revival of old sources and no overlapping device ownership.

### 11.2 Dual-mode and UI acceptance

- Test direct↔processed on the same HW, rapid repeated switching, stop/seek during switching,
  failures, and reconnection; there is only one active PCM handle, old-mode samples do not enter the
  new mode, and the internal token/generation retires expired native results.
- direct integer PCM/DSD satisfies the exact-sample tests; direct lossy shows no passthrough icon;
  processed shows no passthrough whether or not effects are enabled, and Native DSD is explicitly
  rejected under processed.
- Separately verify the actual output effect and mid-playback parameter changes of EQ,
  normalization/ReplayGain, software volume/mute, fade, tempo/pitch, and clipping protection;
  confirm there is no double gain, missing protection, or hidden limiter that cannot be bypassed.
- Verify processed device rate adaptation, DSP latency, tempo tail, seek/media time during tempo
  changes, gapless track boundaries, and statistics; direct must not call the processing resampler.
- processed gapless must also verify: a stale async stage does not revive, a full load does not wait
  for an old network stage, the Core queue/statistics do not advance before the DAC side crosses the
  boundary, leaving tempo/pitch bypass cancels staging, and CUE/SACD/channel changes explicitly fall
  back to an ordinary track switch rather than an implicit remix or a second ALSA runtime.
- Turn the section 9.4 matrix into component/integration tests: under passthrough all entry points
  are inoperable, and already open dialogs/drag/debounce requests become invalid; under processing
  the features are available and there is no passthrough badge. Playing Hi-Res FLAC in processed
  with all effects off is a mandatory scenario, to prevent inferring bit-perfect from source quality
  or all-zero parameters.
- Check that the main player, toolbar, fullscreen, and mobile add no new persistent long technical
  status copy; having no icon is also a legal presentation. If an icon is used, check the short
  tooltip, accessible name, touch detail entry, and status semantics; it must not automatically pop
  up a chain explanation for every track or distinguish the guarantee only by color.
- Use HTTP, WS, plugins, and generic settings to modify directly and verify that Core/native reject
  the capability, rather than testing only the disabled attribute; old capability commands arriving
  after a mode or output switch, old clients, and error responses must not change dormant
  parameters.
- With two Web Control instances open on different dialogs, switch modes on one end; even if the
  other end still holds an old snapshot, a later old parameter command reaching Core must be
  rejected based on the capability derived from the actual mode/path at execution time. Verify
  hidden, disconnected, reconnected, fullscreen, and mobile states, and ensure the combination
  "available DSP + exact passthrough" never appears.
- Configuration migration preserves the old volume/EQ/effects and selects processed;
  direct↔processed save and restore values correctly, switching to passthrough stays paused, and a
  restart does not wrongly restore the other mode's volume or marker.

### 11.3 Integration and build

Run the development guide's full checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`,
`pnpm docs:build`, `cargo check --workspace`, `cargo test --workspace`, `git diff --check`. In
addition, separately verify the ordinary build without the SDK and the Diretta build with the SDK,
the release artifact smoke, and exit.

The dependency tree no longer contains dependencies with no consumers such as CPAL and rustysynth.
Keep signalsmith-stretch, still used by processed, and FFmpeg, needed for
decoding/scanning/HTTP/analysis; cleaning up the old backend must not be used as a reason to delete
DSP product functionality or dependencies that are still needed. Official artifacts continue to
forbid PipeWire/PulseAudio dynamic dependencies, and the configurable plugin entry point of
`alsa-lib` must not be mistaken for "if no desktop sound library is linked, hardware passthrough is
guaranteed".

Regression covers ALSA↔Diretta↔UPnP, Core auto-next, CUE/SACD, the song cache, NetEase/TIDAL,
ListenBrainz, Web multi-client, and plugin errors. Old CPAL/ordinary-path terminology in logs is
updated in sync.

### 11.4 Real-device evidence

Fully record the mode, source hash, build commit/artifact hash, kernel/driver, DAC, HW ID,
negotiated format/rate/channels/sbits, XRUN/interruption count, and test results. Cover the
PCM/Native DSD combinations and switching actually used by the target device; untested combinations
are honestly marked as unverified, not every tier of the device specification sheet is made a
release precondition, and Diretta's 768 kHz/DSD512 achievements are not treated as ALSA
achievements.

Software passthrough acceptance compares the decoded effective PCM samples or DSD logical bit
sequence with the data submitted to the ALSA HW, covering start/end, seek, and track-switch
boundaries; the existing USB driver submit-layer evidence only proves down to that layer.
`hw_params`, the DAC panel, loopback, and analog recording each prove only their own coverage. To
claim end-to-end bit-perfect for a given DAC, additionally do independent device acceptance with a
digital re-record, a device bit test, or a chain that can verify the DSD logical bit sequence;
without that evidence, make no such claim and do not block the software-path release because of it.

Real-device testing must also cover short-track tail drain, pause/resume, rapid seek, same-format
gapless, format-change locking, PCM/DSD mixed playback, device occupancy/hot-plug, systemd
stop/restart/SIGTERM, and overnight looping. Check start/end truncation, pops, error recovery,
statistics boundaries, memory/thread/FD, and temporary cache trends. direct disables fade, so a
software envelope must not be used to mask hardware start/stop problems; processed verifies effects
on/off, software mute, and mode switching, and a failing bit test must not be misreported as a
passthrough defect. Problematic device combinations are recorded honestly and the
configuration/driver cause is identified.

## 12. Completion conditions

This plan is complete only when all of the following conditions are met:

- One ALSA HW backend supports direct/processed with always exactly one active output; exact integer
  PCM, Native DSD, lossy/float playback, and the original PCM DSP features all pass software
  verification in the mode they belong to.
- Local/online, CUE/SACD, preload, media time, exact boundaries, cancellation, start/stop/seek, and
  mode and output switching are usable.
- Core/native enforce the mode constraints, with no bypass through HTTP/WS/settings/plugins; mode,
  capability, actual path, and badge are driven by the same authoritative snapshot, passthrough
  cannot operate DSP, and processing mode never shows exact passthrough.
- The existing UI is reworked item by item per section 9.4, covering already open dialogs,
  shortcuts, mobile/fullscreen, multi-client, and reconnect; processed user configuration is
  preserved, and upgrade and switching do not accidentally turn software attenuation into full-scale
  autoplay.
- CPAL, the old output queue/thread orchestration, the implicit full-path limiter, silence padding,
  and consumer-less modules are cleaned up; DSP algorithms/required dependencies, metadata, readers,
  and UPnP extraction are kept with explicit modes/consumers.
- Ordinary and Diretta builds pass, the shared rework does not break Diretta strict behavior, and
  the ALSA DSP switches are not applied to Diretta/UPnP.
- direct obtains independent exact-sample/DSD logical-bit evidence at the ALSA HW submit layer, and
  both modes complete lifecycle/switching acceptance; existing ordinary ALSA playback records serve
  only as a historical baseline and do not carry over as acceptance results for the new path.

These conditions are not reduced for release deadlines, and keeping the old backend permanently is
not a substitute for completing the new implementation. If implementation reveals a conflict between
this plan and accepted product requirements, revise the design and the Roadmap; keeping DSP
functionality does not mean keeping the old CPAL player.
