# AGENTS.md

## Scope and authority

- Product: Linux x86-64 Node Core with Web Control as the only UI, connected through Core HTTP/WS.
  Scope is one user on a trusted LAN with one active output; extensions require accepted requirements.
- This file defines lasting constraints. [Roadmap](docs/atom-roadmap.md) owns priorities and
  acceptance status; [development guide](docs/atom-development.md) owns workflows and conventions.
- Resolve documentation/code conflicts against accepted requirements: fix nonconforming code or
  stale documentation. Existing code alone does not establish correctness.

## Core and implementation boundaries

- Core owns music-domain state, persistence, credentials, queue, playback policy, source resolution,
  cache/preload, downloads, statistics, plugins, and output assignment.
- Web sends high-level commands and consumes snapshots/events through existing Core contracts.
  It may cache projections and own browser-local display preferences; playable URLs, retry/skip
  policy, and Source Direct staging remain Core-owned.
- ALSA and strict Diretta use the shared `audio-engine`; UPnP is a Core-owned single-renderer path
  under the same playback authority.
- Solve actual problems or accepted requirements with the smallest concrete change. Reuse existing
  models, services, and contracts; never duplicate business authority or canonical state.
- Optimize for minimal changes, simple implementations, stability, and performance. Do not add
  safeguards, fallback paths, or tests solely for speculative edge cases.
- When low-value features cause conflicts or complexity, propose removing them before adding
  defensive machinery. Remove features only when authorized; keep implementation and verification
  proportional to the actual task.
- Split real responsibilities, but add abstractions only for demonstrated needs or repeated
  duplication. Protocol, storage, and UI representations may differ without becoming new authorities.

## Diretta and realtime audio

- Diretta is strict Source Direct: preserve PCM samples, effective bit depth, rate, and channels;
  preserve the native DSD logical one-bit sequence, rate, and channels.
- Lossless decode/container adaptation is allowed. Wider transport slots must preserve effective
  integer sample bits; DSF/DFF bit-order adaptation must preserve the logical DSD sequence.
- No resampling, remixing, normalization, ReplayGain, EQ/preamp, non-unity software gain, fade,
  tempo, pitch, re-encoding, PCM fallback, DoP, or DSD-to-PCM.
- Never route strict Diretta through the normal `f32` DSP/resampler path. Reject unsupported Target
  formats explicitly; never silently process or fall back.
- Keep allocation, locks, logging, discovery, negotiation, and avoidable copying out of the SDK
  realtime callback.

## Data and resource ownership

- Cross-process/Core protocol types live in `shared/types/`; import generated native addon types
  from `@splayer/*` rather than duplicating them.
- Frontend time is milliseconds; convert native seconds at the Core boundary.
- Persist lightweight canonical `Track` values; load details/lyrics on demand and release large
  objects after use. Centralize durable data/cache paths per [deployment](docs/core-deployment.md).
- Caches need explicit eviction. Use appropriately sized images; pause RAF/canvas/high-frequency
  UI work while Web Control is hidden.
- ListenBrainz is Core-owned and performs no background work when disabled. When enabled,
  SQLite/HTTP/retry work stays in its isolated child process and never blocks playback/audio paths.
- Production Core logs go to stdout/stderr for systemd/journald.

## Engineering conventions

- Preserve unrelated working-tree changes and keep independent changes separable.
- Code comments are Chinese and explain non-obvious intent. Follow repository formatting and
  auto-import/component-registration conventions.
