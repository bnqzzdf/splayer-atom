# SPlayer Atom Development Manual

> Last updated: 2026-10-26
>
> Code baseline: `dev` branch commit `5693b3fc`, product version `1.1.3`
>
> Audience: engineers working on Core, Web, native modules, or build scripts

## 1. Development model

SPlayer Atom is "one Core, many clients":

- `core/`: Node/TypeScript, holds music-domain authority;
- `src/`: Vue 3 Web Control, sends commands and consumes projections;
- `shared/`: protocol types and defaults shared by Core and Web;
- `native/`: Rust native modules for strict audio output and Qobuz/TIDAL;
- `scripts/atom/`: build, packaging, and release checks;
- `docs/`: documentation and the docs site.

Two rules matter most:

1. **Never create a second business authority.** Queue, current track, repeat/shuffle, source resolution, retry/skip, cache, downloads, and stats belong only to Core.
2. **Never bypass output-path constraints.** Diretta and Direct ALSA enforce format/processing limits in native code; Web and Core may reject earlier, but must not "help users around" them.

## 2. Environment

### 2.1 Required components

| Component | Version/notes |
| --- | --- |
| Linux x86-64 | Native modules compile only on Linux |
| Node.js | `>=22.19.0` for development; packaging requires **24.18.0** |
| pnpm | `>=10`; repository pins `11.5.2` |
| Rust | stable; CI pins `1.98.0` |
| ALSA headers | `libasound2-dev` |
| C/C++ tools | `clang`, `pkg-config`; Diretta also needs C++ and static `libstdc++.a` |

Debian/Ubuntu:

```bash
sudo apt-get install --no-install-recommends -y \
  libasound2-dev pkg-config clang
```

### 2.2 Install dependencies

```bash
cd /home/kele/splayer-atom-core
pnpm install
```

### 2.3 Version contract

- Runtime floor: Node `>=22.19.0` (`core/atom/runtime/nodeRuntime.ts`).
- Release reference Node: `24.18.0`.
- The Core JS Vite target is `node24`, while the declared runtime floor is `22.19`. Smoke-test on Node 22.19 before shipping an artifact intended for it.
- Database schema: `8`; config schema: `3`; Core Protocol: `1`.

## 3. Quick start

### 3.1 Start the development environment

```bash
pnpm dev
```

This command:

1. builds native modules in debug mode into `out/native`;
2. starts Node Core;
3. starts the Vite Web dev server.

### 3.2 Development port caveat

The current code has a **default port mismatch**:

- Core listens on `14558`;
- the Vite proxy defaults to `14558`;
- the Web dev client hardcodes `14559` (`src/core/controlClient.ts`, `src/core/controlEventClient.ts`);
- `scripts/dev.ts` does not set `ATOM_SERVER_PORT`.

With repository defaults, `pnpm dev` may leave the frontend unable to reach Core. Use:

```bash
ATOM_SERVER_PORT=14559 pnpm dev
```

or unify the proxy and client ports without changing behavior. If you change this, update `scripts/dev.ts`, `vite.config.ts`, `src/core/controlClient.ts`, `src/core/controlEventClient.ts`, and the tests together.

### 3.3 First build

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm build` runs native → typecheck → Core → Web.

## 4. Repository layout

```text
core/
  atom/             Core runtime, control routes, folder routes, UPnP, Direct input
  apis/             NetEase/QQ/Kugou/Qobuz/TIDAL protocol adapters
  core-node/        Core entry point
  database/         SQLite schema, migrations, queries
  plugins/          Plugin registry, host, sandbox, storage
  server/           Hono HTTP, WS, broadcast, request guard
  services/         Playback session, source resolution, cache, downloads, scanning, lyrics, stats
  store/            Settings store and migrations
  utils/            Logging, paths, time, filenames
shared/
  types/            Core/Web protocol types
  defaults/         Default settings, plugin API defaults
  constants/        Core Protocol
  utils/            Shared pure functions
src/
  core/             Core HTTP/WS clients, event projection
  stores/           Pinia stores
  pages/            Pages
  components/       Components
  services/         Lyrics, downloads, playback time, platform home
  settings/         Settings schema and categories
native/
  audio-engine/     N-API wrapper
  audio-engine-core Decoding, ALSA, Diretta, CUE/SACD
  streaming-api/    Qobuz/TIDAL
  diretta-sys/      Diretta SDK FFI
scripts/atom/       Build, packaging, release checks
docs/               Documentation
```

Aliases: `@main/*` → `core/`, `@shared/*` → `shared/`, `@/*` → `src/`.

## 5. Runtime architecture

### 5.1 Processes and threads

| Boundary | Form | Notes |
| --- | --- | --- |
| Core main process | Single Node process | HTTP/WS, SQLite, business state, NAPI calls |
| audio-engine | Same-process NAPI | Rust decode/output threads, position timer, events to JS |
| streaming-api | Same-process NAPI | tokio + reqwest, protocol calls only |
| plugin-host | Forked child | Shared by all enabled plugins; one vm context per plugin |
| ListenBrainz child | Forked child | Created only when enabled; separate SQLite outbox |
| UPnP media server | HTTP server in the main process | Temporary port, auto-closes when idle |
| Web Control | Browser process | HTTP/WS client |

### 5.2 Core startup order

```text
Validate Node version
→ set default environment variables
→ preflight/migrate data schema (before loading store/database)
→ init logger, database, song cache, plugin registry
→ register plugin control events
→ init ListenBrainz child (only when enabled)
→ register player events
→ init download manager
→ init playback session (first player creation)
→ start HTTP/WS
→ asynchronously restore active streaming server connection
```

Key ordering:

- Data migration must happen before store/database imports; otherwise new code may read an old schema.
- Player events must be registered before the first `getPlayer()`.
- If `startServer()` fails, Core exits non-zero.

### 5.3 Shutdown behavior

SIGTERM/SIGINT currently only call `store.flushImmediate()` and then `process.exit`. Playback, downloads, the UPnP media server, plugin host, ListenBrainz child, and Direct temp files are not gracefully cleaned up. Do not assume a global shutdown hook; if you need one, add a unified shutdown coordinator with tests first.

## 6. Core development

### 6.1 Adding an HTTP endpoint

1. **Shared types**: if request/response crosses Core/Web, define or extend types in `shared/types/`.
2. **Service layer**: implement business logic in `core/services/`, not in the route.
3. **Route**: register in `core/atom/headless/routes.ts` or the appropriate module; follow existing `commandError`/validation patterns.
4. **Control client**: add a call in `src/core/*Client.ts` with matching URL and types.
5. **State projection**: if authoritative state changes, publish events and snapshots; do not only update a local store.
6. **Tests**: cover service behavior and the call site (see R5 in section 10).

Route conventions:

- Most command successes return `{ ok: true }` or a full snapshot;
- validation failures return `400 { error }`;
- sample-processing unavailable returns `409 { error: "output_processing_unavailable" }`;
- do not add unauthenticated "arbitrary file read/write" or "arbitrary command execution" endpoints;
- consider the Host/Origin guard and path boundaries.

### 6.2 Playback session invariants

`core/services/playbackSession.ts` is the sole playback authority. Preserve these invariants:

1. **Settle preload before a full load**: call `waitForPlaybackPreloadIdle()` before `loadIndex()`.
2. **An output must be selected**: otherwise `OUTPUT_DEVICE_REQUIRED`.
3. **Generation checks**: after async resolve/load, verify `generation !== loadGeneration` and discard stale results.
4. **Commit NowPlaying before publishing session**: this lets Control recover via `/now-playing` even if it missed `trackLoaded`.
5. **Resolve sources only through `playbackSourceResolver`**: never build playable URLs in routes or UI.
6. **No sample processing on Direct/UPnP**: `assertSampleProcessingAvailable()` is the common gate.
7. **Output switching is transactional**: record old state → stop old output → select new → reload → restore position/intent → roll back on failure.
8. **The preload key must cover every input policy**: queueIndex, track identity, CUE boundaries, songLevel, trial, outputDevice, alsaMode.
9. **Failure policy is bounded**: at most `min(5, queue length)` attempts; device/unknown errors are not skippable.
10. **Never hold a second queue**: Web stores are projections only.

### 6.3 Source resolution chain

`playbackSourceResolver.ts` order:

```text
local → cache → streaming → netease → qobuz/tidal → qqmusic/kugou
```

Inside a provider:

- NetEase: official `song_url` → plugin fallback; trial/entitlement errors classified.
- QQ/Kugou: native URL → plugin fallback; keep the native error when it gives a precise entitlement reason.
- Qobuz/TIDAL: Rust `streaming-api`; no JS fallback.
- Streaming servers: adapter `getStreamUrl` fetched on demand, not stored.

When adding a source:

- extend `TrackSource` in `shared/types/player.ts`;
- add a branch in the resolver;
- define skippable errors and cache keys in `playbackSourcePolicy`;
- update Web `source` handling, search, and collection/artist pages;
- do not bypass the canonical `Track` structure.

### 6.4 Errors and skip policy

- Error codes live in `shared/types/errors.ts`.
- `playerLoad.ts` classifies native errors as `LOAD_SUPERSEDED`, `DEVICE_NOT_FOUND`, `FILE_NOT_FOUND`, `OUTPUT_FORMAT_UNSUPPORTED`, `NETWORK_ERROR`, or `FILE_DECODE_ERROR`.
- The skippable set is in `playbackSourcePolicy.ts`; device and unknown errors are not skippable.
- An online `sourceError` allows one fresh resolve; failure advances.
- When adding an error code, update i18n `errors.{code}` and frontend `handleError()` behavior.

### 6.5 Settings authority

Core settings and browser-local settings are separate:

- **Core-owned**: `player.*`, `library.*`, `lyric.*`, `localLyric.*`, `cache.*`, `download.*`, `streaming.enabled`, `listenbrainz.*`, `system.networkProxy.*`, `system.neteaseRealIp`, `system.neteaseScrobble*`.
- **Browser-local**: theme, language, layout, fonts, lyric display parameters, UI zoom, onboarding flag.
- **Dedicated endpoints**: `player.outputDevice`, `player.volume`, `player.lyricOffsets`, `cache.dir`, `download.dir` do not use the generic settings mutation.
- The generic mutation validates only the path prefix, not the value schema. New settings should be range/type-checked on both Web and Core.

### 6.6 Database and migrations

Database: `data/database/library.db`, WAL mode, schema `8`.

Adding a table/column:

1. Reflect it in the create/alter logic in `core/database/index.ts`.
2. Add a `targetVersion → targetVersion+1` transactional step in `core/database/migration.ts`.
3. Bump `DATABASE_SCHEMA_VERSION`.
4. Consider old-data backfill, fingerprint invalidation, and cache rebuild.
5. Add migration tests: old schema → new schema, data retention, version rejection.
6. Never delete the database to bypass migration; startup rejects newer schemas.

Migration backups:

- created only when an existing DB/config needs upgrading;
- DB uses `VACUUM INTO`, config directory is copied recursively;
- located at `data/backups/migration-*`;
- never cleaned automatically.

### 6.7 Cache and downloads

- Song cache keys are generated only by `playbackSourcePolicy`; do not build keys elsewhere.
- Cache writes must be `.part` → rename with MIME/size/first-byte validation.
- A cache hit must verify the file exists; delete the row if missing.
- LRU eviction runs only after a successful write.
- Downloads are serial; deduplicate by taskId and `source:id:quality`; resolve the URL only when downloading.
- Download temp files live in `<cache>/downloads-tmp`, isolated from the user download directory.
- Delete only Atom-owned files; never delete completed user media.

### 6.8 Plugins

- `core/plugins/loader.ts` parses the script header; the manifest is stored in `plugins/manifest.json`.
- Plugins execute in the host child's vm context; the host gates calls through `dispatchHostCall`.
- When adding a plugin API:
  - bump `@apiLevel`;
  - update `shared/types/plugin.ts`;
  - update `docs/plugins/` and the API reference;
  - add permission/parameter validation in both host and registry;
  - add negative tests (missing permission must fail).
- `events` / `splayer.player.on` are protocol-reserved; Core does not deliver playback events. Do not depend on them in new plugins.

### 6.9 ListenBrainz

- When disabled, create no child, start no timers, and send no HTTP.
- Generate a capture ID only after the threshold; delete the parent's unacknowledged record only after the child persists it.
- Retry state machine lives in the child: 2xx delete, 401 `auth_error`, 408/429/5xx backoff, other 4xx `dead`.
- Do not move SQLite/HTTP back into the Core main process.

## 7. Web development

### 7.1 Stack and entry points

- Vue 3 + Vue Router 5 + Pinia 4 + vue-i18n 11.
- Hash history; lazy-loaded pages.
- `src/main.ts`: `/debug` mounts `HeadlessApp`; normal paths mount `App.vue`.
- `src/layouts/MainLayout.vue`: sidebar, header, player bar, global overlays.
- Vite auto-imports Vue/Pinia/Router/VueUse/i18n; `src/components` is auto-registered.

### 7.2 Pages

| Path | Page | Purpose |
| --- | --- | --- |
| `/onboarding` | Onboarding | Four-step setup |
| `/` | Home | Greeting, stats, recommendations |
| `/platforms` | PlatformHome | Logged-in provider home |
| `/platforms/:platform/section/:section` | PlatformSection | Provider section |
| `/songs` | Songs | Local tracks |
| `/liked` | Liked | Local/NetEase likes |
| `/history` | History | Browser-local play history |
| `/download` | Download | Download tasks |
| `/daily` | Daily | NetEase daily recommendations |
| `/favorites` | Favorites | NetEase favorites |
| `/cloud` | Cloud | NetEase cloud drive |
| `/collection/:source/:type/:id` | Collection | Album/playlist/rank/cloud detail |
| `/artist/:source/:id` | Artist | Artist detail |
| `/artists/local` | LocalList | Local artists |
| `/albums/local` | LocalList | Local albums |
| `/folders` | Folders | Core filesystem browser |
| `/stats` | Stats | Listening stats |
| `/search` | Search | Local/streaming/online search |
| `/streaming/*` | Streaming | Self-hosted server browsing |
| `/debug` | HeadlessApp | Engineering diagnostics |

### 7.3 State

| Store | Responsibility | Persistence |
| --- | --- | --- |
| `settings` | Language, appearance, player-local preferences, Core settings snapshot | localStorage (omit `system`) |
| `theme` | Light/dark, color source, background, cover extraction | localStorage |
| `status` | Playback state, position, volume, output, repeat/shuffle, FM, A/B loop | localStorage subset |
| `queue` | Projection of the Core session queue | No |
| `media` | Current track/detail/lyrics/offset | No |
| `library` | Local tracks, scan dirs/progress, likes, aggregation | localforage |
| `playlist` | Local playlist CRUD | Core + legacy localforage |
| `user` | NetEase account profile/content | localStorage + IndexedDB |
| `data` | Search history, platform profiles, daily archive | localStorage + IndexedDB |
| `history` | Browser play history (500 entries) | IndexedDB |
| `streaming` | Server list, connection, in-memory library | No |
| `download` | Download task mirror | No |
| `plugins` | Plugin list and status | No |
| `providerSessions` | Five-provider login projection | No |
| `coreCapabilities` | `/api/info` capability bits | No |

### 7.4 Core connection and events

- `src/core/controlClient.ts`:
  - production uses `location.origin`; development uses `hostname:14559`;
  - validates `/api/info.protocol` before requests;
  - reads JSON `error` on non-2xx.
- `src/core/controlEventClient.ts`:
  - singleton WebSocket shared by subscribers;
  - after connect, fetches `/session` and `/status` and synthesizes `session`/`status`/`deviceChanged`;
  - polls `/api/status` every 500ms while the page is visible;
  - reconnects 1 second after disconnect; incompatible protocol stops reconnecting.
- Event-to-UI mapping is in `src/core/player/events.ts`.
- Resource URL projection is in `src/core/controlAssets.ts`: `cache://` → `/cache/...`, `streaming-cover://` → `/api/streaming/cover`.

Adding an event:

1. add the type in `shared/types/coreEvents.ts`;
2. publish it with `publishCoreControlEvent()` in Core;
3. map resource URLs in `controlEventClient`;
4. handle it in `events.ts` or the relevant store;
5. add protocol and client tests.

### 7.5 Settings UI

- Settings categories are in `src/settings/categories/*.ts`, aggregated in `src/settings/schema.ts`.
- Note: the category `defaultValue` **does not drive rendering**; actual defaults live in `src/stores/settings.ts` and `shared/defaults/settings.ts`. They have diverged before; use the store default as the source of truth and keep them consistent.
- Core settings are read/written through `settingsClient`; local settings mutate the store directly.
- Custom panels live in `src/components/settings/custom/`.
- i18n conventions: `settings.{key}.label`, `settings.{key}.description`, `settings.group.{category}`.

### 7.6 Components and styles

- Custom UI primitives live in `src/components/ui/` with the `S*` prefix.
- Use UnoCSS theme variables; do not hardcode colors.
- Pages added to the `KeepAlive` allowlist must declare `defineOptions({ name })`.
- Business actions use the `ControlAction` model so menus, context menus, and long-press share semantics.
- Comments follow AGENTS: Chinese, explain only non-obvious "why".

### 7.7 Responsive and i18n

- Breakpoints: `<768` phone, `768–1279` tablet, `>=1280` desktop.
- Phones use a drawer, fixed bottom player, and full-screen settings.
- Languages: `zh-CN` / `en-US`, default Chinese, fallback English.
- Add every new string to both `zh-CN.json` and `en-US.json`; avoid hardcoded Chinese.

## 8. Native development

### 8.1 Crates

| Crate | Purpose |
| --- | --- |
| `native/audio-engine` | N-API wrapper: player, scanner, tags, extraction |
| `native/audio-engine-core` | Decoding, ALSA, Direct PCM/DSD, Diretta, CUE/SACD, DSP |
| `native/streaming-api` | Qobuz/TIDAL protocols |
| `native/diretta-sys` | Diretta SDK C++ bridge |

### 8.2 Build

```bash
pnpm build:native          # release
pnpm build:native --dev    # debug
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets
```

Native builds check:

- `audio-engine.node` must not dynamically depend on `libpipewire*` / `libpulse*`;
- `streaming-api.node` must not dynamically depend on `libssl.so` / `libcrypto.so`.

### 8.3 Diretta constraints

When changing Direct/Diretta code, preserve:

1. strict PCM accepts lossless integer sources only;
2. staged and current connections must match rate/channels/valid_bits/storage_bits/sample_format exactly;
3. PCM ↔ Native DSD cannot switch in the same runtime;
4. DSD must not be processed beyond bit reversal; no DoP/DSD2PCM;
5. the real-time callback must not allocate, lock, log, discover, or negotiate;
6. failures must be explicit; no silent fallback.

When adding format support, add source-level and negative tests first, then hardware acceptance.

### 8.4 N-API surface

- Type declarations are in `native/audio-engine/index.d.ts`; update them with new methods.
- Core accesses the addon through the `core/services/engine.ts` singleton; do not `require` it elsewhere.
- Native errors should preserve classification; Core maps them in `playerLoad.ts`.

## 9. Data and configuration

### 9.1 Configuration storage

- `settings.json`: `deepMerge(defaultSystemConfig, raw)` fills defaults; 200ms debounced atomic write.
- A fresh install sets `__configVersion` to current and skips migrations.
- A config version newer than the build supports refuses startup.
- Migrations live in `core/store/migrations.ts`.

### 9.2 Paths

| Environment | Data root | Cache root |
| --- | --- | --- |
| Packaged | `<install root>/data` | `$XDG_CACHE_HOME/splayer-atom` or `~/.cache/splayer-atom` |
| Development | `$XDG_DATA_HOME/splayer-atom/app-data` | Same as above |

`ATOM_DATA_DIR` overrides the data root; changing it does not migrate old data.

## 10. Testing strategy

### 10.1 Commands

```bash
pnpm typecheck
pnpm lint
pnpm test              # Node test + Vitest
pnpm test:native       # cargo test --workspace
pnpm test:all
```

### 10.2 Layers

| Layer | Location | Focus |
| --- | --- | --- |
| Core unit/service | `core/**/*.test.ts` | State machines, policy, migrations, route contracts |
| Web unit/component | `src/**/*.spec.ts` | Client URLs/bodies, stores, composables, page contracts |
| Native | inline tests under `native/**/src/**` | Direct formats, CUE conversion, Diretta callback, DSD |
| Artifact smoke | `scripts/atom/check-core-artifact.ts` | Startup, HTTP/WS, restart persistence, SIGTERM |
| Hardware acceptance | `pnpm check:hardware-release` | Real ALSA/Diretta/UPnP |

### 10.3 R5: cover the call site

For "return structure + call-site consumption" changes, tests must cover the call site too. Examples:

- new API field: test the route response and the frontend client/store consumption;
- new setting: test Core write and the settings panel's visibility/disable conditions;
- new error code: test service throw and `handleError()` presentation.

### 10.4 R6: negative control

A new assertion script must fail on the **unpatched** code before it passes on the patched code. Otherwise there is no proof that it covers the target behavior.

### 10.5 Test data

- Never commit real accounts, cookies, tokens, playback URLs, or private paths.
- Hardware/online acceptance records must be redacted.
- Fixtures live in `core/services/fixtures/` or the relevant directory; avoid external network dependencies.

## 11. Build and packaging

### 11.1 Commands

| Goal | Command |
| --- | --- |
| Full build | `pnpm build` |
| Native only | `pnpm build:native` |
| Core only | `pnpm build:core` |
| Web only | `pnpm build:web` |
| system package | `pnpm package:core` |
| bundled package | `pnpm package:core:bundled` |
| Debian 11 package | `pnpm package:core:debian11 --without-diretta` |
| Local Diretta package | `DIRETTA_SDK_ROOT=... pnpm package:core:diretta` |
| Source package | `pnpm package:source` |
| Release tag | `pnpm release:tag --dry-run` / `pnpm release:tag --push` |
| Hardware acceptance | `pnpm check:hardware-release -- --artifact <tar.gz>` |
| Doc timestamps | `pnpm docs:stamp` / `pnpm docs:stamp:check` |
| Docs site | `pnpm docs:build` |

### 11.2 Packaging prerequisites

- Packaging requires Node **24.18.0** (both system and bundled).
- The default release build requires the commit to be pushed to a network remote and the worktree clean.
- Local experiments may use `--allow-unpublished`, but the artifact remains marked unpublished.
- Diretta builds require `DIRETTA_SDK_ROOT` pointing at SDK 148 and a `v2|v3|v4|zen4` variant.

### 11.3 Artifacts

```text
out/
  native/                 audio-engine.node, streaming-api.node, build.json
  core/                   index.js, plugin-host.js, listenbrainz-child.js
  renderer/               Web Control
  core-system/            install-root staging
  splayer-atom-core-...tar.gz
```

Artifact name:

```text
splayer-atom-core-<version>-<8-char commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-<system|bundled>-linux-x64.tar.gz
```

`runtime.json` is the authoritative release identity and runtime contract; `native/build.json` is the native build identity.

### 11.4 Reproducibility

- Fix `ATOM_BUILD_DATE` and `ATOM_BUILD_TIME` to reproduce content and filename.
- tar uses `--sort=name --mtime=@<packaging-day midnight> --owner=0 --group=0 --numeric-owner`.
- The source package uses `git archive <commit>`, not the working tree.

### 11.5 Debian 11

Plain `pnpm package:core` does not check glibc. For Debian 11 targets, use:

```bash
pnpm package:core:debian11 --without-diretta
# or
DIRETTA_SDK_ROOT=/path/to/SDK \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

The container build checks that the three native modules require no glibc symbol above 2.31 and cross-checks the Diretta variant.

### 11.6 CI

`.github/workflows/dev.yml` runs on pushes to `dev`:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
cargo clippy --workspace --all-targets
pnpm test:native
pnpm build
pnpm package:core
upload system-runtime artifact
```

CI does not build bundled/Debian/Diretta, does not enforce a glibc gate, and does not publish a Release. Complete those manually before release.

## 12. Engineering discipline (R1–R10)

`AGENTS.md` R1–R10 apply to all code changes, builds, deployments, and debugging:

| Rule | Key point |
| --- | --- |
| R1 | Deliver environment decidability first: prerequisites, health check, baseline, startup self-check; bidirectional conclusion, read-only, build gate |
| R1.1 | Existing projects must build the health check before the next code change; use the `~/engineering-standards/envcheck` engine |
| R1.2 | Register status in `ENGINEERING-PROJECTS.md`: `已建` (built) / `待建` (pending) / `不适用` (N/A) |
| R2 | Assertions green → build → install; structural assertions on comment/string-stripped code |
| R3 | The third recurrence of the same defect becomes an assertion or abstraction |
| R4 | Use named structures for same-type returns; no bare tuple unpacking |
| R5 | Unit tests cover call sites, not just functions |
| R6 | New assertion scripts need a negative control (red without the patch) |
| R7 | Diagnostics/health checks/probes are read-only; list forbidden APIs, assert them, record proof |
| R8 | Conclusions must be backed by evidence; never write "normal" for "undetermined" |
| R9 | Worktree clean before changes; revert bad changes before redoing |
| R10 | Delivery docs state the environment-vs-code boundary and handling steps |

This project's health-check spec is registered in the engineering-standards repository at `envcheck/specs/splayer-atom-core.yml`. **Run it before any code change** and record the conclusion; documentation-only changes do not require it.

## 13. Debugging and diagnostics

### 13.1 Logs

- Core logs go to stdout/stderr with scoped prefixes such as `[core]`, `[player]`, `[server]`.
- No file logs, no access logs, no structured fields.
- Native tracing is not initialized by Core; do not rely on `data/logs/audio-engine-*.log`.
- Plugin `console.*` goes to Core stdout, not a separate file.
- systemd: `journalctl -u splayer-atom-core`.
- OpenRC: `/var/log/splayer-atom-core.log`, `.err.log`.

### 13.2 Probes

```bash
curl -s http://127.0.0.1:14558/api/info
curl -s http://127.0.0.1:14558/api/status
curl -s http://127.0.0.1:14558/api/session
curl -s http://127.0.0.1:14558/api/output/devices
curl -s http://127.0.0.1:14558/api/cache/stats
```

These are read-only GETs. Do not use `POST /api/output/select` or playback commands as probes; they change state.

### 13.3 Playback triage order

1. `/api/info`: version, commit, capabilities, whether Diretta is compiled.
2. `/api/output/devices`: target presence and selection.
3. `/api/session`: queue, index, repeat/shuffle.
4. `/api/status`: state, position, output.path, sampleProcessingAvailable.
5. Core logs: `playerLog.error(code, error)`.
6. If `OUTPUT_FORMAT_UNSUPPORTED`: confirm output path and source format; Diretta has no fallback.

### 13.4 Web triage

- Browser DevTools Network: `/api/*` status and body; `/ws` 101.
- Protocol mismatch: `CORE_PROTOCOL_UNSUPPORTED`; no automatic reconnect.
- 403: Host/Origin guard; check `Host`, `Origin`, `ATOM_ALLOWED_HOSTS`, and the reverse proxy.
- Progress frozen: WS does not push `position`; verify the 500ms `/api/status` poll.
- Setting has no effect: confirm whether it is Core-owned or browser-local; dedicated paths use their own endpoints.

## 14. Common pitfalls

| Pitfall | Fact | Handling |
| --- | --- | --- |
| Development port mismatch | Web dev hardcodes 14559; Core defaults to 14558 | `ATOM_SERVER_PORT=14559 pnpm dev` |
| `PATCH /session/queue/tracks` unreachable | Shadowed by `/:index` | Update items individually or replace the queue |
| Setting `defaultValue` has no effect | `SettingsItem.vue` does not read category defaults | Use store/shared defaults |
| Capability treated as authorization | Server does not reject routes by capability | UI hints only |
| `remoteOutput` is always false | Even though UPnP exists | Do not use it to decide UPnP availability |
| Plugin events are not delivered | `events`/`player.on` are reserved | Do not depend on them |
| Log directory does not exist | `data/logs` has no writer | Use stdout/journald |
| Old binary reads new data | Schema is forward-only | Roll back to the full old install |
| Weak download/cache validation | MIME/size/first-byte only | Invalidate on decode failure |
| Editing `settings.json` shape | Requires migration and version | Follow section 9 |

## 15. Commit and release workflow

### 15.1 Commits

- Use Conventional Commits with a one-line Chinese summary: `<type>: <summary>`.
- Add a body only when explicitly requested.
- Do not reformat or rewrite unrelated dirty files.
- Before committing: `git diff --check` and relevant gates.
- The worktree must be clean before a new change (R9).

### 15.2 Release

1. Confirm a clean worktree and that the commit is pushed to a network remote.
2. Run the full gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:native`.
3. `pnpm build`.
4. Choose the artifact form: system / bundled / Debian 11 / Diretta.
5. Run `check-core-artifact` and `check-hardware-release` (read-only mode).
6. Record `runtime.json`, artifact sha256, capabilities, and acceptance results.
7. Run `pnpm release:tag --dry-run`, then `--push`.

### 15.3 Documentation

- Update `docs/`, this manual, and the API reference when behavior changes.
- `pnpm docs:stamp` updates "Last updated"; `pnpm docs:stamp:check` is the gate.
- Documentation must state the environment-vs-code boundary (R10).

## 16. References

- [Project Book](./01-project.md)
- [Operations Manual](./03-operations.md)
- [API Reference](./05-api.md)
- [Development setup (existing)](../atom-development.md)
- [Build and packaging](../build-and-packaging.md)
- [Native modules](../native.md)
- [Plugin development](../plugins/)
- [Roadmap](../atom-roadmap.md)
- `AGENTS.md` (project constraints and R1–R10)
