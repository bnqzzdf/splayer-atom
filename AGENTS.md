# AGENTS.md

## Authority and current sources

This file contains durable implementation rules. Do not use it as a roadmap or a snapshot of the
current file layout.

- `docs/atom-roadmap.md` is authoritative for product scope, priorities, completion state, and
  acceptance criteria.
- If `AGENTS.md` and `docs/atom-roadmap.md` materially conflict, stop implementation immediately,
  describe the conflict to the user, and wait for explicit clarification. Do not guess which rule
  should win or silently reconcile the two documents.
- `task_plan.md`, `findings.md`, and `progress.md` contain the current working state.
- `docs/atom-development.md`, `docs/types.md`, `docs/upstream-sync.md`,
  `docs/build-flavors.md`, `docs/core-deployment.md`, and `docs/upnp-output-plan.md` own their
  respective operational/design details.
- When documentation and current source disagree, inspect the implementation and update the
  stale document; do not preserve an obsolete architecture for compatibility with prose.

## Product architecture

**SPlayer owns the foundation; Atom owns only the proven delta.** Atom is a continuously updated
downstream of SPlayer-Next. Its confirmed product deltas are Node Core/Headless Web, the unified
Desktop/Web Control surface, Qobuz, TIDAL, ListenBrainz Core Scrobble, Diretta Source Direct, and
single-renderer UPnP source-preserving output.

The long-term model is **Core / Control / Output**:

- Node Core is the only authority for database, settings, library, provider sessions, canonical
  queue, playback policy, source resolution, cache, preload/recovery, play statistics, output
  assignment, and Diretta input materialization.
- Web and Desktop are Controls. They send high-level commands and consume Core snapshots/events;
  local stores may cache projections but must never become a second domain authority.
- Desktop-only window, tray, hotkey, updater, protocol, native-file, lyric-window, and future Output
  Agent behavior is a Host Capability, not a Core Domain fork.
- Desktop and Web music-business requests use the same Core Control Protocol. Keep Electron IPC for
  shell/Host integration and temporarily retained event transport, not for a new parallel business
  API when a Core contract exists.
- Core Local Output uses the shared `audio-engine` through ALSA or Diretta. UPnP is an Atom-owned
  remote execution path below the same Core playback authority; it must not become a second player,
  queue, provider/cache authority, or generic Output framework. See `docs/upnp-output-plan.md`.
- A Desktop Output Agent is not current scope; if a concrete requirement accepts one later, it may
  execute Core jobs but must not own queue/provider/playback policy.
- Do not restore or publish Electron Headless or Pure Rust Headless as a product. The supported
  Headless product is the ordinary Node Core. Historical implementations and artifacts are behavior
  or protocol oracles only, even if a retained runtime discriminator still uses a legacy name.
- Single active output is the current product scope. Do not introduce Zones, synchronized groups,
  or Core-to-endpoint PCM transport without a concrete accepted requirement.
- Headless currently targets one user on a trusted LAN. Authentication, pairing, CSRF, and public
  zero-trust deployment remain P4 unless the product/network boundary explicitly changes.

Atom actively maintains Netease compatibility plus Qobuz and TIDAL product paths. QQ Music and
Kugou remain frozen, inherited upstream compatibility surfaces: do not add Atom-owned login,
entitlement, resolver, cache, Diretta, or product UI architecture for them.

## Minimal downstream rules

For every change, decide in this order:

1. Reuse the current upstream implementation or type.
2. Use an existing upstream hook or the established Atom Core/Control seam.
3. Confirm a real Atom-specific gap.
4. Implement the smallest concrete delta.
5. Generalize only after repeated real duplication appears.

Also enforce these constraints:

- Never duplicate SPlayer media, queue, player, library, lyric, settings, transport, or persistence
  models unless a proven incompatibility requires a small extension.
- Do not add ports/adapters, registries, stores, state machines, or fallback layers for symmetry.
- Do not create a second source of truth in a renderer, Web facade, compatibility router, provider,
  or Output.
- Broad edits across upstream pages/stores/services/native modules are an architecture smell. Stop
  and redesign the seam before proceeding.
- Track upstream-owned touches honestly. Never hide growth with wrappers or move logic merely to
  satisfy a file-count budget.
- `/home/bnqzzdf/code/tinyLMS`, `/home/bnqzzdf/code/tinylms-next`, and retained artifacts are behavior
  or protocol oracles, not product architecture or fidelity references.

## Source updates and Git discipline

- `origin` is the Atom repository and the only default development/release push target.
- Official SPlayer is the only foundation upstream. `splayer` is fetch-only. `vendor/splayer` must
  equal an official SPlayer commit, contain no Atom delta, and move only by fast-forward. Integrate
  it through a dedicated `sync/splayer-*` branch or worktree; never rebase published Atom history.
- When official SPlayer and another source both changed, integrate and stabilize official SPlayer
  first. Do not obtain official-owned UI, player, queue, library, or lifecycle updates indirectly
  through a downstream fork.
- `ffs/dev` from `feifenspace/SPlayer-Next`, maintained by songlian and fetched through the
  fetch-only `ffs` remote, is a candidate capability source, not a second upstream baseline. Never
  merge or rebase it wholesale into Atom, point `vendor/splayer` at it, create a parallel vendor
  branch for it, or record it as the accepted SPlayer baseline.
- Fetch and pin the exact `ffs/dev` candidate commit before review. Inspect candidate commits and
  paths independently. Accept only a narrow, coherent change that fits the current Atom ownership
  model; reject mixed commits instead of importing obsolete architecture and deleting it afterward.
- Directly cherry-pick an `ffs/dev` commit only when the complete commit is independently valid and
  leaves a buildable Atom tree; use `git cherry-pick -x` for provenance. If only the behavior or a
  subset is valid, port the smallest final change onto the current owner without preserving the
  source branch's intermediate state, wrappers, fallback, or directory layout.
- In particular, an `ffs/dev` update must not restore Pure Rust Headless/Core, Rust QQ/Kugou,
  provider/session authority outside Node Core, Qobuz/TIDAL TypeScript protocol fallback, a second
  audio engine or Diretta bridge, `f32` Diretta, or legacy Diretta cfg/build paths.
- Perform each `ffs/dev` port from the latest accepted Atom `dev` on a dedicated `port/ffs-*` branch.
  Keep each commit coherent and usable when checked out alone, retain the source SHA when the user
  authorizes a commit body, and run tests proportional to the affected provider/Core/audio scope.
- Follow `docs/upstream-sync.md` for official integration, accepted-baseline updates, candidate
  reporting, and validation. A moving remote ref is never evidence that Atom has accepted an update.
- General upstream fixes must branch from `vendor/splayer` into a minimal `contrib/*` change; do not
  submit Atom `dev` directly to SPlayer.
- Preserve unrelated working-tree changes and keep ownership-oriented changes separable.
- Commit titles use Conventional Commits with a one-line Chinese summary:
  `<type>: <summary>`. Add a body only when explicitly requested.

## Diretta Source Direct invariants

Diretta is a strict Source Direct path, not another processed SPlayer output backend.

- Preserve source sample rate, channel count, effective PCM bit depth/sample values, and the native
  DSD one-bit sequence. Lossless codec decode is allowed; resampling, remixing, normalization,
  ReplayGain, EQ/preamp, software volume below unity, fade, tempo, pitch, re-encoding, PCM fallback,
  DoP, and DSD-to-PCM are not.
- Never route strict Diretta playback through SPlayer's normal `f32` resampler/DSP pipeline.
- Padding exact integer samples into a wider transport slot is allowed only when sample bits do not
  change. DSF LSB-first and DFF/MSB-first may use per-byte bit reversal only as a lossless wire-order
  adaptation that preserves the logical DSD sequence, rate, and channels.
- If the Target cannot accept the exact PCM format or native DSD rate/channels in either equivalent
  bit order, fail Direct explicitly. Never silently process audio or leave Direct mode.
- Reject sample-altering controls with a clear Direct-mode error instructing the caller to exit
  Source Direct first.
- Keep allocation, mutexes, logging, discovery, negotiation, business logic, and avoidable sample
  copies out of the SDK real-time callback. Prefer borrowed/ref-counted decode or SDK buffers with
  producer-side preallocated adaptation.
- Ambiguous discovery/connection failures do not prove a stale or occupied Target. Stop retries and
  ask the user to confirm exclusive Target availability before recovery, reset, or power-cycle work.
- Linux live Diretta connection/playback validation runs the Host process as root. User-mode
  discovery success does not prove connection privileges, and its timeout must not be diagnosed as
  a Target fault.
- Reuse proven tinyLMS lifecycle/protocol lessons only when they satisfy these invariants; reject its
  resampling, normalization, whole-track RAM, or unsafe buffer-lifetime patterns.

## Runtime, build, and validation

- Core supports Node `>=24.18.0 <25`; release/artifact gates use reference Node `24.18.0`.
- The Linux x86-64 Core `core-audio` flavor builds only the required native runtime modules: `audio-engine`
  and the Qobuz/TIDAL `streaming-api`; it must remain free of Electron, Chromium, GTK,
  PipeWire/PulseAudio, and Desktop-only native modules at runtime.
- A Diretta-branded Core release must use the Host SDK release declared by `docs/build-flavors.md`
  and the release workflow, together with the required-SDK gate. Missing or mismatched SDK
  provenance must fail before producing a same-named artifact.
- The final `tar.gz` artifact, its runtime metadata, startup/termination, Core endpoints, Web root,
  native addons, and plugin-host IPC are the release unit; a source-tree build alone is insufficient.
- Real ALSA/Diretta/PCM/Native-DSD/long-run behavior remains a separate hardware gate. Never infer
  hardware acceptance from compile or fixture tests.

Common repository checks are:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm build:native --dev
cargo check --workspace
cargo test --workspace
node scripts/atom/check-upstream-touch.mjs
git diff --check
```

Run checks proportional to the change. Use `docs/atom-development.md` and `docs/build-flavors.md`
for Core artifact and platform-specific commands. Real audio behavior remains a separate hardware
gate even when the full Cargo workspace passes. Do not format or rewrite unrelated dirty files.

## Engineering conventions

### Code and comments

- Code comments are Chinese. Methods use concise JSDoc with `@param name - ...` and `@returns` when
  meaningful. Comment only when the reason is non-obvious.
- Do not use decorative separator comments, prose essays, obvious restatements, or numbered lists
  inside comments.
- Split real responsibilities into files, but do not extract a helper for a one-place caller; three
  uses normally justify extraction.
- Avoid speculative defensive paths, impossible fallbacks, per-case error enums, and configurable
  timeout/retry/buffer knobs without a requirement. Prefer plain `Error`/`anyhow` and constants.

### Types, units, and persistence

- Cross-process/Core Protocol types live in `shared/types/`; do not hand-write native addon types—
  import them from `@splayer/*`.
- Frontend time is milliseconds. Convert native seconds at the main/Core boundary.
- Use lightweight canonical `Track` values for queue/session persistence; load `TrackDetail` on
  demand and never retain or persist large lyric/detail payloads unnecessarily.
- Use `shallowRef` for Track collections and `toRaw` before IndexedDB persistence to avoid Vue proxy
  clone failures.
- Keep all durable path decisions centralized. Core durable `data/`, cache/log behavior, migration,
  backup, and rollback follow `docs/core-deployment.md`; do not add hidden state roots.

### Transport and runtime ownership

- Reuse `buildCoreControlRoutes()` and existing Core clients. Do not duplicate Desktop/Web routes or
  let Control resolve final playable URLs, own retry/skip, or manage Direct staging.
- Core settings and provider credentials remain Core-owned. Desktop `safeStorage` is only for
  Control-local secrets such as a Core connection credential.
- ListenBrainz is Core-owned but must be runtime-zero when disabled: no child process, outbox DB,
  HTTP client, retry timer, or high-frequency listener. When enabled, its SQLite/HTTP/retry work
  runs only in an isolated child process; playback/audio paths must never await it or perform its
  synchronous I/O, network, locks, or retry work. Do not create a generic scrobble/provider
  framework until repeated real consumers justify it.
- Use scoped main-process loggers from `@main/utils/logger`; never import `electron-log` directly.
- Preload `onEvent` registration must remove old listeners before adding one, and renderer consumers
  must unsubscribe on unmount.
- Lyric windows reuse `windows/shared/` synchronization/selection utilities; do not reimplement the
  timing engine in each window.

### Memory and rendering

- Memory is a hard requirement. Rendering/cache/IPC changes must compare the existing periodic
  `app.getAppMetrics()` samples before and after.
- Use the 300 px cover for blurred, sampled, color-extraction, and list rendering. Use the original
  only for the visible large cover/export; large images use `decoding="async"` and decode before fade.
- Do not apply persistent `will-change` to unbounded collections or add full-screen blur/compositing
  layers without justification.
- Hidden surfaces are silent: gate high-frequency position/FFT/sync pushes, and stop RAF/canvas work
  while hidden. Low-frequency state/track events still propagate.
- Every module-level cache must have an eviction rule; never retain `TrackDetail`-sized data beyond
  the current track.

### Formatting

- Prettier uses double quotes, semicolons, 100-character width, and trailing commas.
- Vue/Pinia/router/VueUse/i18n APIs are auto-imported, and components under `src/components/` are
  auto-registered; follow existing imports instead of adding redundant ones.

## Final architecture review

Before completing architecture-affecting work, ask:

- Could upstream or an existing Core/Control seam do this directly?
- Did this create a second authority, speculative domain, or translation layer?
- Did it modify more upstream-owned code than necessary?
- Can any new Atom layer be removed without losing required behavior?
- For Diretta, did any PCM sample value/rate/channel layout or logical DSD sequence/rate/channel
  count change between source decode and Target?

Simplify before merging when the answer exposes unnecessary structure or audio processing.
