# AGENTS.md

## Authority and product scope

This file contains durable implementation rules. `docs/atom-roadmap.md` is authoritative for
current priorities, completion state, and acceptance criteria. When documentation and source
disagree, inspect the implementation and update the stale document rather than preserving obsolete
behavior.

SPlayer Atom has exactly one supported product shape:

- **Node Core** is the application runtime and the only music-domain authority.
- **Web Control** is the only user interface and communicates with Core through the Core HTTP/WS
  contract.
- **Linux x86-64** is the only supported release platform until a new platform is explicitly added
  and accepted.

There is no Desktop edition. Do not add or restore Electron, Chromium packaging, preload/IPC,
desktop windows, tray, global hotkeys, desktop/taskbar lyrics, updater, native desktop media
integration, desktop protocol handlers, desktop file pickers, or Windows/macOS application builds.

## Core / Control / Output architecture

Node Core is the only authority for database, settings, library, provider sessions, canonical
queue, playback policy, source resolution, cache, preload/recovery, play statistics, downloads,
plugins, ListenBrainz, output assignment, and Source Direct materialization.

Web Control sends high-level commands and consumes Core snapshots/events. Browser stores may cache
projections, but must never become a second queue, provider, settings, playback, or output authority.

Output rules:

- Local output uses the shared `audio-engine` through ALSA or strict Diretta Source Direct.
- UPnP is a Core-owned single-renderer execution path below the same playback authority.
- Single active output is the current product scope. Do not introduce Zones, synchronized groups,
  or a second player/output state model without an explicit accepted requirement.

Core is intended for one user on a trusted LAN. Authentication, pairing, TLS termination, CSRF,
and public zero-trust deployment are separate product decisions and must not be invented ad hoc.

## Minimal implementation rules

For every change:

1. Reuse the current Core model, service, type, or HTTP/WS contract.
2. Confirm a real Atom-specific gap.
3. Implement the smallest concrete delta.
4. Generalize only after repeated real duplication appears.

Never create a second media, queue, player, library, lyric, settings, provider, transport, or
persistence model. Do not add registries, adapters, fallback layers, state machines, or facades only
for symmetry. Broad changes across unrelated Core/Web areas are an architecture smell.

## Git discipline

- `origin` is the development and release repository.
- Preserve unrelated working-tree changes and keep logically independent changes separable.
- Commit titles use Conventional Commits with a one-line Chinese summary:
  `<type>: <summary>`.
- Add a commit body only when explicitly requested.

## Diretta Source Direct invariants

Diretta is a strict Source Direct path, not a processed output backend.

- Preserve source sample rate, channel count, effective PCM bit depth/sample values, and the native
  DSD logical one-bit sequence.
- Lossless decode/container adaptation is allowed. Resampling, remixing, normalization,
  ReplayGain, EQ/preamp, software volume below unity, fade, tempo, pitch, re-encoding, PCM fallback,
  DoP, and DSD-to-PCM are not.
- Never route strict Diretta playback through the normal `f32` DSP/resampler path.
- Wider transport slots are allowed only when effective integer sample bits remain unchanged.
- DSF/DFF bit-order adaptation is allowed only when the logical DSD sequence, rate, and channels are
  preserved exactly.
- If the Target cannot accept the exact format, fail explicitly rather than silently processing or
  falling back.
- Keep allocation, locks, logging, discovery, negotiation, and avoidable copying out of the SDK
  realtime callback.
- Linux live Diretta connection/playback validation runs the Host process as root.

## Runtime, build, and release

- Core supports Node `>=24.18.0 <25`; formal artifacts use reference Node `24.18.0`.
- The supported release target is Linux x86-64.
- The Core native flavor contains only `audio-engine.node` and `streaming-api.node`; it must not
  carry Electron, Chromium, GTK, PipeWire/PulseAudio, or desktop-only native modules.
- Linux binary compatibility is part of the release contract. Build formal artifacts in the pinned
  release environment and audit the highest required `GLIBC_x.y` symbol across every shipped ELF.
- A Diretta-branded artifact must pass the required-SDK provenance gate before an artifact is
  produced.
- The final `tar.gz` artifact, runtime metadata, native addon load, Web root, HTTP/WS endpoints,
  plugin-host IPC, startup, and termination form the software release unit.
- Real ALSA/Diretta/PCM/Native-DSD/UPnP and long-run behavior remain separate hardware gates.

Common checks:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm docs:build
cargo check --workspace
cargo test --workspace
git diff --check
```

Run checks proportional to the change. Do not format or rewrite unrelated dirty files.

## Engineering conventions

### Code and comments

- Code comments are Chinese.
- Methods use concise JSDoc with `@param name - ...` and `@returns` when useful.
- Avoid decorative comments, obvious restatements, speculative fallback paths, and configurable
  knobs without a requirement.
- Split real responsibilities into files; do not extract one-use helpers merely for aesthetics.

### Types, units, and persistence

- Cross-process/Core protocol types live in `shared/types/`.
- Do not hand-write native addon types; import generated types from `@splayer/*`.
- Frontend time is milliseconds. Convert native seconds at the Core boundary.
- Persist lightweight canonical `Track` values; load large detail/lyric payloads on demand.
- Keep durable data/cache path decisions centralized and follow `docs/core-deployment.md`.

### Core/Web ownership

- Reuse `buildCoreControlRoutes()` and the existing HTTP/WS clients.
- Web Control must not resolve final playable URLs, own retry/skip policy, or manage Direct staging.
- Provider credentials and settings are Core-owned.
- ListenBrainz is Core-owned and runtime-zero when disabled. When enabled, its SQLite/HTTP/retry
  work stays in the isolated child process and never blocks playback/audio paths.
- Core logs go to stdout/stderr in production so systemd/journald owns operational logging.

### Memory and rendering

- Memory is a hard requirement; caches need explicit eviction.
- Avoid retaining `TrackDetail`-sized objects beyond their active use.
- Use the 300 px cover for blurred/sampled/list rendering and original images only where visibly
  required.
- Pause RAF/canvas/high-frequency UI work when the Web Control page is hidden.

### Formatting

- Prettier uses double quotes, semicolons, 100-character width, and trailing commas.
- Follow existing Vue/Pinia/router/VueUse/i18n auto-import and component auto-registration rules.

## Final architecture review

Before completing architecture-affecting work, ask:

- Did this create any authority outside Node Core?
- Did this reintroduce a Desktop/Electron concept?
- Did this add a second protocol, provider, queue, playback, output, or persistence model?
- Can any new layer be removed without losing required Core/Web behavior?
- For Diretta, did any PCM sample/rate/channel or logical DSD sequence/rate/channel change?

Simplify before merging when the answer exposes unnecessary structure.
