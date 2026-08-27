# SPlayer Atom Development Setup

## Current baseline

- Upstream branch: `dev`
- Checked baseline: `0f5a2fc`
- Node/TypeScript/Vue baseline: green
- Upstream JS/Web tests: 96/96 pass
- Production build with `SKIP_NATIVE_BUILD=true`: green
- Rust/native baseline: green on Linux (`build:native --dev` succeeds; `cargo test -p audio-engine` 56/56)

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
