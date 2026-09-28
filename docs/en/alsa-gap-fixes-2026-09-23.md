# 2026-09-23 ALSA gap fixes and partial FC4 re-test

> Last updated: 2026-09-28

The source commits for this round of fixes are `123cbdac` (end-of-track decode failure
classification), `37aee7a1` (Processed tempo, limiter, and end-of-track drain), `9e76bfa2`
(queue/buffer-pool bounds), and `53284360` (pause drain cancellation).
The FC4 runtime verification used a local release native module containing the four fixes above;
at build time only documentation and comments were uncommitted. This is not a clean Core install
artifact, and it does not prove bit-perfect output at the DAC.

## Fixes and software verification

- A known decode failure is reported as `SourceError` even when it happens within the last
  3 seconds of a track; only a normal EOF is reported as `Ended`.
- Signalsmith Stretch's warm-up output is trimmed from the playout stream, and at EOF it is
  advanced with silence corresponding to the input latency and the valid tail is retrieved. The
  output frame count is rounded by the accumulated tempo ratio, and the DSP block maps the
  actually playable output frames back to source samples; switching back to bypass first drains
  the old effect. Staging the next track resets the limiter history.
- During a Processed natural EOF drain, entering `XRUN/Setup` after the hardware consumes the
  last frame or returning `EPIPE` is treated as a terminal drain; a pause drain is still handled
  as an error.
- The Processed decode/DSP queue is split into single blocks of at most 4096 frames, bounding the
  block count and capacity of idle buffers; after splitting an oversized block, the total source
  sample count and the track boundary of the first block are preserved. In all three ALSA modes,
  a runtime cancel flag interrupts the drain when there is no hardware pause, and an active close
  is no longer marked as a Direct output failure. This fallback branch has not yet been measured
  on a device with no hardware pause.
- `CARGO_PROFILE_TEST_DEBUG=0 cargo test -p audio-engine-core --lib -q`: 180 pass.
  With `--features diretta`: 175 pass; `cargo check -p audio-engine --features diretta`
  passes. `cargo fmt --all --check` and `git diff --check` pass.
- `DIRETTA_SDK_ROOT=/home/bnqzzdf/code/DirettaHostSDK_150 DIRETTA_CPU_VARIANT=v3
cargo build -p audio-engine --release --features diretta` passes. The local module
  `target/release/libaudio_engine.so` SHA256 is
  `af101c5ee61032196ec1f6c3f7d9904b2d58a90f76b744aba2d45b91fbf42dee`.

## FC4 observations

The original Core state was FC4 Direct with a single track paused at position 2961 ms. The test
first stopped the old output through the Core API, then used the temporary native module to open
`alsa:hw:CARD=FC4,DEV=0`. A 0.6-second, 44.1 kHz, 16-bit stereo WAV had a 0.1-second sine signal
at each end. The initial local build produced `outputFailed` when +5 semitones was enabled, and
the native log pointed to a failure waiting for an ALSA PCM event; after fixing the Processed
natural end-of-track drain, the re-test was as follows:

- +5 semitones at normal speed: only one `ended` received, position reached 0.6 s, no
  `sourceError/outputFailed`.
- +5 semitones, 1.25×: likewise only one `ended` received, position reached 0.6 s, no
  `sourceError/outputFailed`.
- With the same fixed module, a Processed seek on a local FLAC to 30 seconds still left it at
  `playing/processed-pcm`, and switching to Direct afterwards played, with path `exact-pcm`.
- Playing the same local FLAC at +5 semitones and 1.25×, after seeking to 30 seconds it was still
  `playing/processed-pcm`, with the position then observed at 30.58 s; after switching back to
  1×/0 semitones, Direct still played.
- After the test exited and released the temporary output, Core was restored to FC4 Direct with a
  single track paused, 2961 ms, `exact-pcm`.

The non-zero head and tail of the short-track signal and the total output frame count are verified
by DSP unit tests; this FC4 run records events, progress, and output availability, with no digital
capture, so it cannot claim on that basis that the tail is correct sample by sample at the DAC.
The actual follow-up work is to check the target devices' modes, formats, lifecycle, and resource
trends with a clean Core artifact; only when a memory anomaly is observed should the upstream
single allocation be investigated. Both the no-hardware-pause fallback and DAC-side bit-perfect
are accepted per the corresponding device and declared scope.
