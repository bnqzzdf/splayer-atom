# Native Modules

> Last updated: 2026-10-03

SPlayer Atom native code exists only for the Linux x86-64 Node Core runtime.

## Modules

| Module                     | Responsibility                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `native/audio-engine`      | N-API audio entry used by Core for ALSA and optional Diretta Source Direct                    |
| `native/audio-engine-core` | Shared Rust engine for decode, normal playback, Direct PCM/DSD, CUE/SACD, and DSP foundations |
| `native/streaming-api`     | The only native Qobuz/TIDAL protocol engine                                                   |
| `native/diretta-sys`       | Diretta Host SDK FFI; the formal SDK remains external                                         |

The Core build produces two project-owned addons:

```text
audio-engine.node
streaming-api.node
```

Artifacts also include required third-party native dependencies such as `better-sqlite3`.

## Build

```bash
pnpm build:native
pnpm build:native --dev
```

The formal Core native flavor uses `core-audio`, and the Linux output backend is ALSA. The build script checks the two project-owned addons with `ldd`; the build fails if either gate does not pass:

- `audio-engine.node`: PipeWire/PulseAudio dynamic dependencies (`libpipewire*` / `libpulse*`) are forbidden (`scripts/atom/build-core-native.ts:124-128`);
- `streaming-api.node`: OpenSSL dynamic dependencies (`libssl.so` / `libcrypto.so`) are forbidden (`scripts/atom/build-core-native.ts:132-138`).

## audio-engine-core

`audio-engine-core` is the pure-Rust shared implementation. Normal ALSA playback may use the internal processing chain; Diretta uses a separate strict Source Direct path and must never pass through the normal `f32` DSP/resampler.

### CUE / SACD

- CUE virtual track start/end boundaries are owned by Core;
- SACD stereo virtual tracks are parsed by Core/native together;
- The temporary extraction/materialization required by UPnP stays isolated from normal/Direct playback.

## Diretta

The Diretta feature is built only when `DIRETTA_SDK_ROOT` is present. Formal Diretta artifacts use `--require-diretta` to enforce SDK provenance.

The strict Source Direct invariants are defined in the root `AGENTS.md`.

## Tests

```bash
cargo check --workspace
cargo test --workspace
pnpm test:native
```

Real ALSA, Diretta Target, Native DSD, and UPnP behavior requires separate hardware acceptance.
