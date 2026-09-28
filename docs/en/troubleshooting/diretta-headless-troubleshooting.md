# Diretta Core troubleshooting

> Last updated: 2026-09-28

This page only describes the Diretta Source Direct path of the current production Atom Core: Node Core owns business logic and source materialization, `audio-engine.node` calls the strict Direct runtime of `audio-engine-core`, and `diretta-sys` is the only Diretta Host SDK FFI. The old Pure Rust Axum Headless, the regular `f32` Diretta output backend, and the old push FFI are all retired.

## Runtime boundary

```text
Node Core
  -> audio-engine.node
  -> audio-engine-core::direct_runtime
       -> direct_pcm / direct_dsd
       -> diretta
       -> diretta-sys
       -> Diretta Host SDK / Target
```

Source Direct must preserve the source sample rate, channels, effective PCM bits, and the Native DSD one-bit sequence. When the Target does not support the exact format, it fails explicitly, with no resampling, software volume, EQ, normalization, fade, tempo/pitch, DoP, or DSD-to-PCM fallback.

## SDK and build

The production Diretta build provides the SDK through `DIRETTA_SDK_ROOT`. The Core build script explicitly enables the Cargo `diretta` feature when that variable is present; without the SDK, `diretta-sys` does not enter the dependency graph. The SDK release gate is managed by the production build/release scripts and `docs/build-flavors.md`.

Do not restore the `atom_diretta` crate-local cfg, do not guess an SDK under the user's home in `build.rs`, and do not restore a second C++ bridge.

## Discovery succeeds but connection fails

A successful Diretta discovery only means the Target can be found; it does not prove that the Host process has the permissions needed to complete the connection and send in realtime. Per project rules, real Linux connection and playback acceptance use a root Host process; a userspace discovery timeout or connection failure cannot be diagnosed directly as a Target fault.

If discovery/connection is ambiguous:

1. Confirm the Target is not held exclusively by another Host.
2. Retry with the production Core artifact and the same SDK provenance.
3. Check the exact-format negotiation/error in the Core logs; do not work around it by changing the sample rate or entering the regular DSP path.
4. Only after confirming Target exclusivity and Host permissions should a Target reset/power-cycle be considered.

## Realtime callback constraints

The SDK pull callback in `diretta-sys/src/bridge.cpp` only borrows the payload already prepared in the Direct ring. In the realtime callback, discovery, format negotiation, logging, mutexes, dynamic allocation, and avoidable sample copies are forbidden. Only after the SDK release callback may the Direct ring reuse an in-flight slot.

Under Diretta Source Direct, PCM Direct only accepts strict integer PCM storage (S16/S32; a 24-bit source may use an S32 transport slot that preserves the effective bits), while float PCM is explicitly rejected; the ALSA Direct path, by contrast, accepts Float32 (the zero-copy transport of `pack_direct_pcm` in `alsa/format.rs` and `alsa/direct_pcm.rs`). DSF/DFF may only perform byte-by-byte bit reversal for wire bit-order, and must keep the logical DSD bit sequence unchanged.

## Acceptance

The software gates include at least:

- `cargo test -p audio-engine-core`
- `cargo test -p audio-engine --no-run`
- strict Direct fixtures: PCM16/24/32, FLAC/ALAC/WavPack/APE, DSF/DFF, seek, gapless, underrun
- Static assertions on the Direct implementation must not contain `f32`, resampler, EQ, normalization, or other sample-altering pipeline
- A Core native build without the SDK must not link/compile the Diretta SDK
- A Core artifact with the SDK must pass the real Target's PCM and Native DSD exact-format hardware gate

When hardware tests fail, preserve the error semantics and fix the real lifecycle/permission/protocol issue; do not add a float fallback, silent retry, or a second Diretta implementation.
