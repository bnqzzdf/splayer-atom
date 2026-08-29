# SPlayer Atom Development Setup

## Current baseline

- Atom repository: `https://github.com/bnqzzdf/splayer-atom.git` (`origin`)
- Official upstream transport: `splayer/dev`
- Accepted Atom upstream baseline: `0f5a2fcbf81904ea4303929f4cb285a57c1d6eee`
- Pure upstream mirror: `vendor/splayer`
- Current automated Atom baseline: Node/Web tests, typecheck, ESLint, touch audit, Linux native gates and the Core system artifact pipeline are green; exact evolving test counts are recorded in `progress.md` rather than frozen here
- Upstream synchronization, accepted-baseline updates and integration gates are documented in [`upstream-sync.md`](./upstream-sync.md)
- Desktop/Core build flavor boundaries are documented in [`build-flavors.md`](./build-flavors.md); Core installation, upgrade and rollback are documented in [`core-deployment.md`](./core-deployment.md)

The accepted baseline is intentionally fixed. A normal `git fetch splayer` may move `splayer/dev` and `vendor/splayer` may be fast-forwarded to a newer official commit, but the touch audit continues to compare against the last fully integrated and accepted baseline until that candidate has been merged and validated.

## Upstream synchronization

Before architecture work after an upstream update, verify the repository topology and candidate state:

```bash
node scripts/atom/upstream-sync.mjs status
node scripts/atom/upstream-sync.mjs report
node scripts/atom/check-upstream-touch.mjs
```

`origin` is `bnqzzdf/splayer-atom`; `splayer` is fetch-only and must never be a release/push target. `vendor/splayer` only points to official SPlayer commits and only moves by fast-forward. See `docs/upstream-sync.md` for the complete integration/worktree/CI flow.

The upstream touch audit reports two independently bounded categories: the established Atom business-code delta and the explicit Node Core runtime-neutral seams. Runtime seams are limited to Electron-path/fetch/lifecycle/event integration points and have their own budget; adding a file to that category requires an architecture justification rather than silently increasing the business budget.

## Node Core development bootstrap

The first independent Node Core entry is `electron/main/core-node/index.ts`; it builds through `scripts/atom/vite.core.config.ts` into `out/core`. The current bootstrap reuses the existing settings store, database, song cache, playback session and Hono HTTP/WebSocket services. The built JS graph must contain no `electron` import.

Development smoke:

```bash
node node_modules/vite/bin/vite.js build --config scripts/atom/vite.core.config.ts
grep -RIl 'from "electron"' out/core --include='*.js'
ATOM_USER_DATA_DIR=/tmp/splayer-atom-core-smoke \
  ELECTRON_RENDERER_URL=http://127.0.0.1:9 \
  node out/core/index.js
```

With `ELECTRON_RENDERER_URL` set, the development Core listens on port `14559`; `/api/info`, `/api/session` and `/api/library/count` are the minimal development process smoke endpoints. Formal local Core artifact validation uses `pnpm exec tsx scripts/atom/build-core-system.ts` on reference Node `24.18.0`; see `docs/build-flavors.md` for the complete flavor/release boundary.

## Linux native toolchain

On Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y build-essential clang pkg-config \
  libasound2-dev libdbus-1-dev libpipewire-0.3-dev libpulse-dev curl
```

Install Rust with rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
rustc --version
cargo --version
```

The upstream audio engine vendors/static-builds its FFmpeg dependency, so no system FFmpeg package is required for the normal native build.

## Validate the native upstream baseline

From the repository root:

```bash
cd /home/bnqzzdf/code/splayer-atom
PATH="$HOME/.cargo/bin:$PATH" pnpm build:native --dev
PATH="$HOME/.cargo/bin:$PATH" cargo test -p audio-engine
```

On Linux, use `cargo test -p audio-engine` as the native acceptance command. The full `pnpm test:native` workspace test also compiles Windows-only taskbar crates and is the upstream Windows CI criterion rather than the Linux one.

If Electron's native Node dependency needs rebuilding after the earlier install with lifecycle scripts disabled:

```bash
pnpm exec electron-rebuild -f -w better-sqlite3
```

Then the normal application checks are:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Qobuz development credentials

Atom has no runtime dependency on `qobuz-dl`. By default it uses the same proven Web Player Bundle route to auto-discover the current Qobuz app id and signing-secret candidates, caches them only in memory, and tries candidates until a signed request succeeds.

Manual application credentials remain optional overrides:

```bash
export QOBUZ_APP_ID="..."
export QOBUZ_APP_SECRET="..."
```

A user's own Qobuz authentication token is still required for authenticated API/search/playback acceptance:

```bash
export QOBUZ_USER_AUTH_TOKEN="..."
pnpm dev
```

Do not commit or paste the user's token into project files. `QOBUZ_USER_ID` is no longer required. Atom validates a supplied token through the current token-based API flow and persists validated tokens using Electron `safeStorage`.

## Current Qobuz implementation

The first Qobuz vertical slice is implemented as:

```text
Web Player app-credential discovery
        ↓
user_auth_token
        ↓
existing apis:call dispatch
        ↓
existing Platform/Search UI
        ↓
existing SPlayer Track/Queue
        ↓
signed track/getFileUrl
        ↓
existing audioSource/song cache/player
```

The remaining Phase 13 acceptance item is a real search → queue → playback run with a locally supplied user auth token. Web Player app-credential discovery has already been validated live without exposing any secret values.

Rules for the Qobuz slice:

- do not add an Atom provider framework;
- do not create Atom Track/Album/Playlist models;
- do not read `~/.config/qobuz-dl` or require qobuz-dl to be installed;
- keep Web Player app-credential discovery narrow, in-memory, and based on the qobuz-dl-proven Bundle route;
- do not persist automatically discovered Qobuz app secrets to disk;
- do not add a second Qobuz URL/download cache when SPlayer's song cache is sufficient;
- implement only search/auth/stream behavior required by the real playback path;
- defer album/artist/favorite expansion until a real UI flow needs it.

## TIDAL development credentials

The current Atom TIDAL slice does **not** embed the retained tinyLMS shared client ID/secret. For development with an existing user OAuth session, preload the access token locally:

```bash
export TIDAL_ACCESS_TOKEN="..."
# optional when refresh is available:
export TIDAL_REFRESH_TOKEN="..."
export TIDAL_CLIENT_ID="..."
export TIDAL_EXPIRES_AT="..."      # epoch milliseconds
export TIDAL_COUNTRY_CODE="US"
pnpm dev
```

`TIDAL_CLIENT_SECRET` is an optional environment-only override for OAuth clients that require Basic authentication during refresh; Atom never persists it. Do not commit or paste OAuth tokens/client secrets into project files or chat.

First-party Authorization Code/PKCE login UX is deferred until SPlayer Atom has its own TIDAL Developer application and redirect configuration. Do not restore the old tinyLMS embedded/shared client credentials as a product dependency.

## Current TIDAL implementation

```text
user OAuth access/refresh token
        ↓
existing apis:call dispatch
        ↓
existing Platform/Search UI
        ↓
canonical SPlayer Track/Queue
        ↓
playbackinfopostpaywall
        ├── JSON/BTS URL ─────────→ existing audioSource/player
        └── DASH MPD
              ↓
          init + media segments
              ↓
          temporary fragmented MP4
              ↓
          existing SPlayer MOV/FLAC decoder
```

The DASH temp file is process-lifetime materialization, not a second persistent song cache. It is cleaned up on exit and is deliberately marked non-cacheable by the normal single-URL cache path. A local decoder proof confirmed the current built SPlayer audio engine can load fragmented MP4 containing FLAC directly, so **runtime system ffmpeg is not required** for TIDAL DASH playback.

Real account/full-track entitlement acceptance remains deferred until a user OAuth token and suitable TIDAL application authorization are available.
