# UPnP source-faithful output plan

> Last updated: 2026-09-28

Status (current code, 2026-09-23): the discovery, transport, output, and media modules under
`core/atom/upnp/` and the Core playback integration are implemented; the software comparison for
CUE/SACD/DSD and partial real-device AudioSys results are in section 12. The media stream FD leak
exposed by the first mixed long playback already has a `stream.pipeline()` fix and a 30-time forced
reload verification. On 2026-09-23 the local regression was expanded to 100 consecutive early
disconnects, confirming at every 20 iterations that the FD count for that media file was 0, all
passing; an AudioSys Renderer is currently unavailable, so the second real-device sustained long
playback, the final compatibility matrix, and release-package re-verification remain open.

Date: 2026-09-07.

This document defines the final implementation plan for Atom's UPnP output. UPnP is only one
additional output method for Core; it does not change SPlayer's basic player model, and it does not
establish a second queue, provider, cache, playback policy, or audio engine. Implementation lands
preferentially in Atom-owned code; shared or native code is modified minimally only when the
existing seams cannot carry the required behavior.

SACD reader correctness is maintained by `audio-engine-core` itself and is not part of the UPnP
implementation scope. UPnP only reuses the already existing and independently verified CUE, PCM,
SACD, DST, and DSF/DFF capabilities.

## 1. Goals and boundaries

- Single user, trusted IPv4 LAN, a single UPnP AV MediaRenderer.
- Core remains the sole authority for the database, settings, canonical queue, provider session,
  source resolver, cache, preload/recovery, play statistics, and output assignment.
- UPnP does not own the queue and does not hand the queue to the Renderer; after natural end, Core's
  repeat/shuffle/next policy still selects the next track.
- Transfer the original file bytes preferentially; only when CUE, SACD ISO, DSD CUE, or device
  container compatibility genuinely requires it, generate an equivalent resource that preserves the
  sample/logical DSD sequence.
- All new extraction paths support two channels only. Unknown channel layouts, mono, multichannel,
  and SACD ISOs without a stereo area fail explicitly, with no downmix.
- No resampling, no remix, no normalization, no ReplayGain, EQ, fade, tempo, pitch, software volume,
  or DSD-to-PCM; DSD does not use DoP.
- Renderer-internal processing and DAC bit-perfect output are separate hardware acceptance, not
  inferred from "Core sent the original file".
- No multi-room, synchronized Zones, OpenHome Playlist, general-purpose MediaServer/ContentDirectory,
  extra Output Agent, second audio engine, or new provider protocol implementation.

## 2. Implementation principles

Execute according to the minimal-downstream rule in `AGENTS.md`:

1. Reuse the existing SPlayer/Atom types, Core Control, queue, resolver, cache, and playback policy.
2. UPnP-specific protocol and runtime state exist only in `core/atom/upnp/`.
3. The existing native/local/Diretta paths are integrated by wrapping with early branches, not
   rewritten into a general Output framework.
4. Extract existing helpers only when a second real consumer appears; do not pre-build registries,
   adapters, capability graphs, or state machines for possible future implementations.
5. New functionality should primarily grow inside UPnP's own modules; adding eventing,
   ConnectionManager, device compatibility, and similar capabilities should not restructure the Core
   playback architecture again.

## 3. Stable module boundaries

New:

```text
core/atom/upnp/
  discovery.ts
  transport.ts
  output.ts
  media.ts
```

### `discovery.ts` — find the Renderer

Responsible for bounded SSDP M-SEARCH, reading the device description, deduplicating by UDN, and
resolving the Renderer's service endpoints. The first version only requires obtaining:

```text
UDN
friendlyName
LOCATION
AVTransport serviceType/controlURL
```

The `eventSubURL`, `SCPDURL`, and ConnectionManager information already present in the description
can be retained at low cost, but the first version does not implement eventing, an SCPD capability
engine, or connection lifecycle because of that.

The first version has no resident SSDP watcher and maintains no alive/byebye/max-age state machine.
Refreshing the output list scans one fixed short window; before playing a persisted `upnp:<UDN>`, if
there is no current descriptor, one more scan may be performed, and if it fails the device is
reported unavailable.

### `transport.ts` — UPnP wire protocol

Responsible for XML/SOAP/DIDL-Lite and the AVTransport actions actually used at present:

```text
SetAVTransportURI
Play
Pause
Stop
Seek
GetTransportInfo
GetPositionInfo
```

Internally only a small shared request logic `soapAction()` is needed. The first version uses
AVTransport InstanceID 0.

When real devices later need `SetNextAVTransportURI`, GENA eventing, ConnectionManager, or more
actions, extend only this module and `output.ts` first; split files once the complexity genuinely
grows, and do not pre-build a general UPnP SDK.

### `output.ts` — Atom's UPnP execution instance

This is the stable seam between playbackSession and UPnP. It is responsible only for the current
Renderer's execution state:

```text
scan/list/select
load
play/pause/stop/seek
status observation
current generation/resource
release
```

It knows nothing about provider, queue, repeat, shuffle, source recovery, or persistence business
logic. The first version polls status at low frequency with `GetTransportInfo` + `GetPositionInfo`
and does not implement SUBSCRIBE/NOTIFY.

### `media.ts` — media resources the Renderer can pull

It manages only the current/switching local file handles and provides:

```text
GET
HEAD
single byte Range
206 / Content-Range
416
```

The resource ID is a non-derivable opaque handle that can only map to files Core has already
prepared; it accepts no arbitrary user path or provider URL.

`media.ts` maintains its own extremely thin Atom-owned HTTP listener that serves only UPnP media and
does not carry Core Control and WebSocket. This way all Web Control behavior stays consistent, and
the existing startup and exposure semantics of `externalApi.enabled/allowLan` are unchanged. The
listener uses an ephemeral port, starts on demand, and is released when there are no resources or on
exit.

## 4. Output identity and reuse of existing Control

UPnP continues to use the existing `AudioDevice`:

```text
id: upnp:<UDN>
name: Renderer friendlyName
isDefault: false
```

It does not extend `AudioDevice.kind/availability/capabilities` for UPnP, nor modify the
`PlayerStatus` schema. Like the existing `diretta:`, `upnp:` is distinguished by the stable ID
namespace.

Continue to use the existing Core Protocol:

```text
GET  /output/devices
POST /output/select
GET  /status
existing play/pause/stop/seek/session/event
```

`GET /output/devices` continues to serve as the refresh action, merging local + Diretta + UPnP scan
results, without adding `/output/refresh`. The Web output selector continues to consume the same
`AudioDevice[]`; the output projection only needs to let `upnp:` through.

When UPnP is selected, `GET /status` reads the latest observed values from `output.ts`; otherwise the
existing native status path is kept. `volume`/`speed` keep the existing number contract; they are
Atom local player settings and do not represent the remote Renderer's RenderingControl state. UPnP
media itself does not pass through these local DSP/volume settings.

The first version does not call RenderingControl SetVolume/SetMute, nor modify the shared volume
types or the Core Protocol version for UPnP.

## 5. Minimal PlaybackSession integration

`core/services/playbackSession.ts` is the Core playback authority, therefore no `IOutput`, Output
registry, or adapter hierarchy is added.

### load

`loadIndex()` keeps the existing source resolver and policy:

```text
resolvePlaybackSource(track)
        |
        +-- selected output is upnp:
        |     prepare media resource
        |     output.load(resource)
        |     publish existing Track/NowPlaying/stats projection
        |     return
        |
        +-- otherwise
              existing loadPlayerSource() path unchanged
```

The native/local/Diretta branch keeps its existing responsibility boundaries, avoiding unrelated
expansion.

UPnP does not fake an `AudioPlayer` or a native `LoadResult`. The needed presentation, NowPlaying,
Netease, ListenBrainz, and Core play stats preferentially reuse the existing public helpers; a common
commit helper is extracted only once stable duplication actually appears. `directGapless.ts` has
already proven that a special execution path can directly reuse these existing services without
restructuring `playerLoad.ts`.

### play / pause / stop / seek

When `upnp:` is selected, `playbackSession.play/pause/stop/seek` delegate to `output.ts`; otherwise
the existing native calls are kept. The existing Web Control Play/Pause/Stop/Seek already delegates
to playbackSession, so no new Control API is needed for UPnP.

Capabilities in the legacy IPC that are explicitly bound to DSP/native device continue to belong to
the native player; no global restructuring is done for UPnP. The first UPnP version only guarantees
that standard playback commands go through the Core authority.

### output switch

`setOutputDevice()` uses an early branch:

```text
target upnp        -> switchToUpnp() -> return
previous upnp      -> switchFromUpnp() -> return
native <-> native  -> existing implementation unchanged
```

On switch, best effort is made to preserve the current playback intent and position. If the target
supports seek, the position is restored; if not, it loads from the beginning or stays paused, and the
exact behavior is fixed after acceptance with the first reference Renderer. Failures such as Renderer
Stop/SetURI directly fail this switch; the first version does not establish a stop-unconfirmed state
machine, a force-confirm API, or a complex rollback framework.

### preload

The first UPnP version does not establish a second preload, nor call `SetNextAVTransportURI`. The
existing ordinary source resolve preload can continue to be reused, but it must not trigger Diretta
native staging. The Diretta decision should be based on the Core-owned `player.outputDevice`, to
avoid a misjudgment when the native player still keeps the old device after UPnP is selected.

## 6. Media preparation

### Local files and existing cache

For standalone FLAC/WAV/MP3/AAC/M4A/DSF/DFF etc., if the Renderer can accept them directly, serve
the original file byte-identical over HTTP preferentially. Reopening a Range still reads the same
immutable file.

### Online platforms

Netease/Qobuz/TIDAL/streaming/plugin all continue to call the existing `resolvePlaybackSource()`.
UPnP does not know the provider protocol and does not parse manifests.

If the resolver already returned a local path/cache path, serve it directly. If it is still HTTP(S),
the first version fully materializes it first and then provides it to the Renderer; there is no
download-while-playing relay.

The exact HTTP bytes -> `.part` -> rename primitive is in `core/atom/exactInput.ts`
(`writeExactHttpInput`, `:63`/`:78`/`:111`); `core/atom/directInput.ts:6`/`:65` are only its callers,
not the home of that implementation. During implementation, reuse its reusable parts first; if the
Diretta-specific temp/lifecycle makes direct reuse unworkable, then extract the minimal Atom-owned
exact-byte helper. Diretta and UPnP still separately own their temp root and cleanup lifecycle, do
not duplicate the download implementation, and UPnP does not depend on Diretta directory semantics.

### Temporary resource lifecycle

The first version does not establish a persistent extraction cache, fingerprint database, pin/evict
framework, or converted-resource registry. Each generation only produces the resource currently
required:

```text
create unique .part
-> generate/copy complete file
-> generation still current ? rename/publish : delete
-> stop/change/shutdown -> release/delete temporary resource
```

Repeated playback of the same track is allowed to regenerate. Only after real performance data proves
it necessary is caching added on the existing `media.ts` seam, without changing the Core
architecture.

## 7. Format and fidelity strategy

| Input                                  | Preferred delivery                        | Guarantee                                                                   |
| -------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Standalone ordinary file               | Original file                             | byte-identical                                                              |
| Integer lossless PCM CUE               | Standalone PCM WAV/WAVE_FORMAT_EXTENSIBLE | rate/channel/effective bit depth/sample value preserved                     |
| SACD ISO stereo track                  | DSF                                       | track range and logical DSD sequence preserved                              |
| Standalone DSF/DFF                     | Original file                             | byte-identical                                                              |
| DSD CUE                                | Standalone DSF                            | logical DSD sequence/rate/channel preserved                                 |
| Necessary DFF->DSF per-track packaging | Equivalent container                      | layout/bit-order mechanical adaptation only, logical DSD sequence unchanged |

Lossy sources such as MP3/AAC can still be sent in their original format as standalone files, but
their CUE tracks are not declared as lossless integer PCM extraction. Floating-point PCM CUE,
unknown effective bit depth, unknown channel layout, or input whose boundaries cannot be determined
exactly are explicitly unsupported.

### CUE

UPnP CUE does not use the render-layer `cueStartMs` to infer boundaries, but reuses the 75 fps raw
coordinates of the existing Rust CUE parser. Adjacent tracks of the same master share the same
absolute boundary, the interval is `[start, end)`, and the last track runs to the real EOF. The
existing INDEX 00/01, pregap, and multi-FILE semantics are followed, without inventing another Track
identity.

The first version changes the CUE representation to PCM WAV/WAVE_FORMAT_EXTENSIBLE instead of adding a
FLAC encoder for UPnP. It reuses the existing strict integer `DirectPcmDecoder`, performing only exact
seek/decode/crop and WAV header writing, without passing through swr/f32/dither. **Boundary rule
difference**: UPnP's CUE boundary is a rounded mapping
(`cue_frame_to_sample = (frame75 * rate + 37) / 75` in
`native/audio-engine-core/src/media_extract.rs:59-64`), which differs from the "frame75 divisible by
75" required by the Direct playback path, so the decoder is reused here but Direct's integer-division
crop semantics are not inherited. If real Renderer compatibility later proves FLAC necessary, a FLAC
writer can be added on the same extraction seam while Core, the UPnP protocol, and the media server
all remain unchanged.

### SACD ISO

Only explicit stereo area/2ch tracks are accepted. The existing `SacdTrackReader` is reused. The
correctness of the SACD reader / DST decoder is still maintained by `audio-engine-core` itself; UPnP
only consumes its already-verified logical DSD output. Uncompressed DSD reads the logical DSD stream
directly; compressed DST is first losslessly decompressed into the same logical DSD stream and then
packaged as DSF. The current DST correctness gate has already passed full-track byte-by-byte
verification against the independent `sacd_extract/libdstdec` with two different real ISOs.

The preferred output is two-channel DSF. Real verification with the reference AudioSys Renderer shows
that original/generated DSF is timed correctly and ends naturally, while generated DFF, although
declared supported by its `GetProtocolInfo`, stays in PLAYING and does not advance position; therefore
the first version does not keep an unused DFF writer. If another real Renderer later explicitly needs
generated DFF, it is added only on the same extraction seam, without changing Core.

### Native DSD

Standalone DSF/DFF that can play as the original file are not rewritten. When DSD CUE or SACD must
generate a standalone resource, DSF is preferred; splitting a DFF master into DSF only allows channel
layout reordering and per-byte bit-order conversion, preserving the effective sample/bit count, rate,
channel identity, and logical one-bit sequence. Padding does not count toward the effective sequence;
when an equivalent representation is impossible, it fails explicitly, without adding silence bits or
converting to PCM.

## 8. Native modification boundary

Ordinary-file UPnP playback does not require modifying `audio-engine-core`.

If the CUE/ISO/DSD per-track stage genuinely needs native file generation, add only one offline
consumer:

```text
native/audio-engine-core/src/media_extract.rs
```

It reuses the existing public readers:

```text
cue/*
DirectPcmDecoder / DirectPcmFrame
SacdTrackReader
DsfReader + reverse_byte (`media_extract.rs:14`; the write side is `DsfWriter`, `media_extract.rs:420`)
existing DST decoder (already passed the independent full-track correctness gate)
```

It does not modify `player/*`, the normal decoder/DSP, the Diretta runtime, or existing Direct
playback semantics. If an independent correctness problem in an existing reader would drag unrelated
fixes into UPnP, the offline consumer may implement only the minimal container reading logic needed
by the current file generation, rather than modifying that reader through UPnP; that logic still must
not become a second playback reader or a general container framework.

NAPI does not add UPnP methods to `AudioPlayer`. If Node Core must call native extraction, add a thin
Atom-specific export file, for example:

```text
native/audio-engine/src/atom_media_extract.rs
```

It only passes parameters to `audio_engine_core::media_extract` and returns a file-level result. The
existing `bindings/player.rs` stays unchanged; no second native addon is added.

## 9. Status, end, and statistics

During playback, the first version's `output.ts` polls the Renderer at low frequency. `/status` only
reads the latest observation and does not increase the device request rate because of multiple
Controls.

Natural end uses the minimal conservative conditions: the current generation was once observed
PLAYING, then observed STOPPED, the position is close to the known duration, and there is no current
Core-initiated stop/switch/seek intent; once satisfied, the existing Core ended/next policy is
invoked. When natural end cannot be confirmed, stay stopped and do not advance blindly.

NowPlaying, Netease, Core play stats, and ListenBrainz continue to use the existing services; no
second tracker is created. UPnP starts/resumes the playing wall-clock only after actually observing
PLAYING; Pause/Stopped stops the accumulation. Output switching or a same-track reload continues the
existing same-track statistics semantics, and a natural next track/repeat establishes a new playback
session.

## 10. Capabilities not implemented in the first version but allowed by the architecture

None of the following is a prerequisite for basic UPnP output:

- GENA SUBSCRIBE/NOTIFY;
- ConnectionManager `PrepareForConnection`;
- `SetNextAVTransportURI` / gapless;
- SCPD dynamic capability model;
- Renderer quirk registry;
- persistent representation cache;
- online source relay;
- multi-room/synchronization;
- RenderingControl volume control.

When these requirements appear, growth should happen mainly in `discovery.ts`, `transport.ts`,
`output.ts`, or `media.ts`, rather than modifying the queue, provider, Core Protocol, or audio
playback architecture again.

## 11. Implementation phases

| Phase | Work                                                                                                          | Completion evidence                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P0    | Synchronize scope; lock SSDP/XML dependencies; establish the four-module skeleton                             | AGENTS/roadmap/plan consistent; no shared schema expansion                               |
| P1    | Discovery, SOAP, DIDL, standalone media listener, ordinary local files                                        | Reference Renderer single-track closed loop; original file hash/Range consistent         |
| P2    | playbackSession/output/status/switch/automatic next integration                                               | Three tracks playing consecutively without Control; native/local/Diretta path regression |
| P3    | Full materialization of online sources, reusing resolver/cache/exact-byte helper                              | Reuse the existing provider resolver, no new protocol implementation                     |
| P4a   | CUE -> exact PCM WAV                                                                                          | Multi-FILE/INDEX/pregap/boundary/effective-bit-depth sample-by-sample comparison         |
| P4b   | SACD ISO -> DSF                                                                                               | stereo track first/middle/last track logical DSD sequence comparison; mch rejected       |
| P4c   | DSD CUE; standalone DSF/DFF continue to prefer the original file                                              | Multiple DSD rates, padding, bit-order/channel identity comparison                       |
| P5    | Add the necessary UPnP compatibility based on real devices; the current reference AudioSys uses generated DSF | New capabilities confined to the UPnP seam, without expanding the Core architecture      |
| P6    | Failures, long playback, final artifacts, and the compatibility matrix                                        | UPnP<->ALSA/Diretta regression, resource stability, real-device records                  |

## 12. Testing and release gates

### Protocol and Core

- Duplicate SSDP responses, no devices, repeated refreshes, no residual socket/timer on process exit.
- description relative URLs, XML namespace, SOAP Fault, and timeouts.
- GET/HEAD/single Range/206/416; complete original file and Range-reassembled hash consistent.
- A mock Renderer actually pulls media, verifying SetURI/Play/Pause/Stop/Seek and status polling.
- Manual stop does not auto-next; natural end is consumed only once; an old generation does not
  pollute new resources.
- The UPnP path does not call native `AudioPlayer.load/play`, DSP, or the Diretta stage.
- `/output/devices` works with the existing Web Control selector without a new protocol schema.

### CUE / SACD / DSD

- CUE uses sample-by-sample pattern comparison between the decoded PCM of the output WAV and the
  master interval, covering 16/20/24/32 valid bits, common sample rates, adjacent tracks, last track,
  INDEX 00/01, multi-FILE, and input without a seektable.
- ISO compares channel-by-channel and bit-by-bit using known DSD patterns or independent results;
  Track 1/middle/last track, a missing stereo area, and malformed/truncated DST all fail explicitly;
  valid compressed DST must match the independent decoder's logical DSD full track.
- Library scanning must expand the stereo area of a physical SACD ISO into a stable virtual path per
  track; each track uses its own title/track/duration, and writing the total area duration into a
  single Track 1 is not allowed. Legacy physical-ISO aggregate records are migrated in place by the
  incremental scan, and unchanged ISOs are not parsed again.
- DSF/DFF equivalent packaging is compared by a unified logical sequence, padding does not
  participate in the sequence; multichannel is explicitly rejected.
- The native extraction worker does not open ALSA/Diretta, does not enter the realtime callback, and
  does not return a full-track PCM/DSD buffer to JS.

### Real devices

- Ordinary FLAC/WAV/MP3/AAC/M4A for the designated reference Renderer and the formats/rates it
  actually supports.
- CUE WAV, SACD DSF, DSD CUE DSF, original-file DSF/DFF; combinations the device does not support
  fail explicitly.
- Automatic three tracks, repeat, pause/resume, seek, manual next, all Controls closed.
- Bidirectional UPnP <-> ALSA/Diretta switching as well as Core restart/SIGTERM.
- A long mixed ordinary/CUE/ISO/DSD queue, confirming FD/socket/timer/temp file/RSS do not keep
  growing with the track count.

The current AudioSys reference real device has already completed ordinary formats, CUE WAV,
original/generated DSF, real uncompressed and DST stereo SACD ISO, automatic next/repeat without any
Control, bidirectional ALSA/Diretta switching, Core restart/SIGTERM, and online source verification
with real Netease/TIDAL accounts. Both platforms went through canonical Track -> existing provider
resolver -> full materialization/cache -> AudioSys, and used short online tracks to verify that Core
auto-nexts after natural end. The generated DSF of real uncompressed SACD Track 1 matches the ISO
reader's logical DSD sequence channel by channel across the full track; for DST, two different real
ISOs additionally completed full-track byte-by-byte consistency verification of 246,480,192 and
235,077,696 logical DSD bytes respectively against the independent `sacd_extract/libdstdec`, among
which Beethoven Sonatas DST Track 3 has passed AudioSys playback, seek, and natural next. Standalone
DFF is not yet in the verified matrix because there is currently no external sample. For resource
pressure there is already evidence of 60 CUE switches with no linear FD/temp growth; the first long
playback round of about 11 hours 12 minutes with about 29 complete cycles of a seven-category mixed
queue showed no playback/UPnP/DST errors functionally, but exposed that when AudioSys disconnects the
original DSF HTTP request early, one `ReadStream` FD leaks per round. The media listener has been
switched to `stream.pipeline()`, a regression requiring the FD to be closed after a Renderer abort was
added, and on the fixed artifact 30 consecutive forced reloads of the original DSF verified the
residual target FD=0 and total FD falling back to 41. The sustained-run results of the second long
playback round have not yet been recorded. On 2026-09-23, in a local environment without AudioSys,
`media.test.ts` simulated a Renderer starting to pull and then disconnecting early 100 consecutive
times, and at every 20 iterations the original DSF file FD was confirmed to fall back to 0; this is a
stress regression for media HTTP resource reclamation and does not include a real Renderer's mixed
queue or the long-run socket/temp/RSS trend. The final stability gate is not closed until it is
confirmed again that FD/socket/temp/RSS do not grow with the round count during real long playback.

A real Renderer accepting a resource does not equal DAC bit-perfect. The final compatibility matrix
records separately: Core byte/sample/DSD sequence preservation, the container/rate accepted by the
Renderer, and the actual DAC output result when measurement conditions are available.

## 13. Architecture completion review

Before completing each UPnP phase, confirm:

- whether there is still only one Core queue/provider/playback policy authority;
- whether the additions/modifications are mainly in Atom-owned code;
- whether unnecessary shared schemas, upstream UI, native player, or Direct runtime were rewritten
  for UPnP;
- whether new UPnP capabilities can grow only inside the four stable modules;
- whether the original file is sent preferentially, with sample/logical-DSD-sequence-preserving
  conversion only when explicitly necessary;
- whether registries, state machines, cache layers, or fallbacks without a real requirement were
  introduced.

If any item exposes broad unrelated native touches, redesign the seam first, then continue
implementing.

## 14. References

- UPnP Device Architecture 1.1: basic SSDP, description, and SOAP semantics.
- AVTransport Service: SetURI, Play/Pause/Stop/Seek and transport/position state.
- `/home/bnqzzdf/code/tinyLMS`: only as a UPnP/CUE/SACD behavior reference, not as a source of Atom
  product architecture.
- Atom's currently reusable seams: `playbackSession.ts`, `playbackSourceResolver.ts`, `songCache.ts`,
  `directInput.ts`, `direct_pcm.rs`, `cue/*`, `sacd/*`, `dsd/*`.
