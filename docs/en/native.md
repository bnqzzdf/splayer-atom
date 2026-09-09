# Native Modules

SPlayer Atom native code exists only for the Linux x86-64 Node Core runtime.

## Modules

| Module                     | Responsibility                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `native/audio-engine`      | N-API audio entry used by Core for ALSA and optional Diretta Source Direct                    |
| `native/audio-engine-core` | Shared Rust engine for decode, normal playback, Direct PCM/DSD, CUE/SACD, and DSP foundations |
| `native/streaming-api`     | The only native Qobuz/TIDAL protocol engine                                                   |
| `native/diretta-sys`       | Diretta Host SDK FFI; the formal SDK remains external                                         |

Formal Core artifacts ship only:

```text
audio-engine.node
streaming-api.node
```

There are no Desktop media-control, taskbar-lyric, audio-capture, or other desktop-only native addons.

## Build

```bash
pnpm build:native
pnpm build:native --dev
```

The formal `core-audio` flavor uses ALSA on Linux. The build checks `audio-engine.node` with `ldd` and rejects PipeWire/PulseAudio dynamic dependencies in the Core artifact.

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
