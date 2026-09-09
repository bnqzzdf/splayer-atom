# Native Modules

SPlayer Atom keeps native audio, streaming-protocol, and platform integration in **Rust**. Node/Electron-facing modules are compiled with [NAPI-RS](https://napi.rs/) into `.node` addons, while the shared audio implementation lives in the pure-Rust `audio-engine-core` crate. All modules live under `native/`.

## Modules

| Module              | Responsibility                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `audio-engine-core` | Shared PCM/DSD decode, cpal normal output, DSP, CUE/SACD, strict Source Direct, Diretta runtime |
| `audio-engine`      | N-API binding for `audio-engine-core`, used by both Desktop and Core                            |
| `streaming-api`     | Atom's single Rust Qobuz/TIDAL protocol implementation                                          |
| `audio-capture`     | Windows/Linux native audio-capture support                                                      |
| `media-ctrl`        | Windows SMTC, Linux MPRIS, macOS Now Playing, and Discord RPC                                   |
| `taskbar-lyric`     | Windows taskbar lyric rendering                                                                 |
| `taskbar-thumbnail` | Replaces the Windows taskbar thumbnail and Peek preview with album art                          |
| `opencc`            | Native OpenCC integration                                                                       |

### audio-engine-core / audio-engine

- Decodes MP3, FLAC, WAV, AAC, OGG, APE, and more through `ffmpeg_audio`.
- Normal Desktop output uses cpal: Linux PipeWire/PulseAudio, macOS CoreAudio, and Windows WASAPI.
- Normal output supports fades, speed/pitch, normalization, EQ/preamp, and FFT.
- The Linux Core `core-audio` flavor keeps an ALSA-only native surface and excludes Desktop PipeWire/PulseAudio features.
- Diretta strict Source Direct uses a separate Direct runtime; PCM/Native DSD does not enter the normal float DSP path.
- CUE virtual tracks, SACD stereo virtual tracks, and related decode/extract support live in the shared Core.
- Produces realtime FFT data for visualizations and lyric motion.
- Extracts cover thumbnails while decoding.
- Streams remote audio through `ffmpeg_audio::HttpAudioSource`. `HttpCancelHandle` supports immediate cancellation and seek reset, while `reqwest` and `rustls` handle TLS without system FFmpeg dependencies.

`audio-engine` exposes these capabilities to Node/Electron; it is not a second player implementation.

### streaming-api

Qobuz/TIDAL protocol, signing/auth, manifest, and related protocol logic are kept in the single Rust `streaming-api` implementation. Node Core owns session/policy and calls this implementation over N-API.

### media-ctrl

Provides system media controls on Windows, Linux, and macOS, plus Discord Rich Presence.

### taskbar-lyric

Renders lyrics in the Windows taskbar and adapts to theme and taskbar state.

### taskbar-thumbnail

Uses DWM iconic representation on Windows to replace the taskbar hover thumbnail and full-size Peek preview with album artwork.

## Building

Install the **Rust toolchain** through [rustup](https://rustup.rs/). `pnpm dev` and `pnpm build` compile native modules automatically.

```bash
pnpm build:native
pnpm build:native --dev
```

Core artifacts use a dedicated native flavor instead:

```bash
pnpm exec tsx scripts/atom/build-core-native.ts
```

It produces only `audio-engine.node` and `streaming-api.node`. Use `scripts/atom/build-core-system.ts` for a complete Core artifact. See [`build-and-packaging.md`](./build-and-packaging.md) for packaging and Linux glibc guidance.

NAPI-RS generates each module's `index.d.ts`. The main process imports them through aliases:

```text
@splayer/audio-engine      → native/audio-engine
@splayer/media-ctrl        → native/media-ctrl
@splayer/taskbar-lyric     → native/taskbar-lyric
@splayer/taskbar-thumbnail → native/taskbar-thumbnail
```

::: tip Skipping native builds
For renderer-only work, set `SKIP_NATIVE_BUILD=true`:

```bash
SKIP_NATIVE_BUILD=true pnpm dev
```

:::

::: warning Do not edit generated declarations
Do not edit `native/*/index.d.ts`. Import native types from `@splayer/*`.
:::

::: warning Linux glibc floor is an artifact property
A local Linux build may inherit a newer glibc symbol requirement from its build host. Formal Linux artifacts should be built in a pinned builder/sysroot and the final `.node`, Electron/Node, and other ELF files must be scanned for their highest `GLIBC_x.y` requirement. See [`build-and-packaging.md`](./build-and-packaging.md).
:::
