# SPlayer Atom Operations Manual

> Last updated: 2026-10-26
>
> Code baseline: `dev` branch commit `5693b3fc`, product version `1.1.3`
>
> Audience: deployment, operations, on-call, and acceptance staff

## 1. What is operated

On a target host, SPlayer Atom consists of:

- one persistent **Core** service (Node process) listening for HTTP/WS;
- two optional child processes: plugin host and ListenBrainz child;
- persistent data under `<install root>/data/`;
- rebuildable cache under the XDG cache directory;
- a Web Control static site served by Core on the same port.

Operational boundaries:

- Core has **no authentication and no TLS**; deploy it only on a trusted LAN or behind an authenticated reverse proxy.
- Core **never deletes user music files**; cleanup covers only Atom's own cache, temp files, and incomplete downloads.
- `data/` is authoritative persistent state; cache may be lost, `data/` must not.
- Upgrades must preserve the full old installation so rollback never depends on an old binary reading new data.

## 2. Deployment forms and prerequisites

### 2.1 Artifact forms

| Form | Node source | Target requirement |
| --- | --- | --- |
| system-runtime | Host Node | Node `>=22.19.0` |
| bundled-runtime | Bundled `runtime/bin/node` | No system Node |
| Debian 11 bundled | Bundled Node | glibc `>=2.30` |
| Diretta variant | Depends on build | root, SDK 148, matching CPU variant |

### 2.2 Prerequisite checklist

| Entity | Satisfied when | Check |
| --- | --- | --- |
| Linux x86-64 | `uname -m` is `x86_64` | `uname -m` |
| glibc | Debian 11 package needs `>=2.30` | `ldd --version` |
| Node (system package) | `>=22.19.0` | `node --version` |
| Service account | Exists and can write `data/` and cache | `id <user>`, `sudo -u <user> test -w ...` |
| ALSA device | Target user can access `/dev/snd/*` | `aplay -l`, `id <user>` |
| ALSA headers (build only) | `libasound2-dev` present | `pkg-config --exists alsa` |
| Port 14558 | Not in use | `ss -ltnp \| grep 14558` |
| Data directory | Writable, enough space | `df -h`, `test -w` |
| Cache directory | Writable, enough space | `df -h` |
| Diretta (optional) | root, SDK 148 artifact, Target exclusively available | `/api/info`, hardware acceptance |
| UPnP (optional) | Renderer reachable, SSDP multicast works | `/api/output/devices` |
| Online providers (optional) | Outbound 443, valid account | Provider login and playback test |

### 2.3 Ports

| Port | Protocol | Direction | Purpose |
| --- | --- | --- | --- |
| 14558 | TCP | inbound | Core HTTP + WebSocket + Web Control |
| 1900 | UDP | outbound/multicast | SSDP discovery |
| random | TCP | inbound | UPnP media server (Renderer pull) |
| random | TCP | inbound | Qobuz OAuth local callback |
| 443 | TCP | outbound | Online providers, ListenBrainz, plugin install |

### 2.4 On-site verification (2026-10-26)

A read-only check was performed on a GentooPlayer x86-64-v2 host (address and credentials omitted). It is a useful deployment reference:

| Item | Observed | Conclusion |
| --- | --- | --- |
| init system | OpenRC; `rc-service status` returned `started` | Matches `install-openrc.sh` |
| Runtime user | root | Required for Diretta |
| Node | System `v22.15.0`; process used bundled `v24.18.0` | System Node is below `>=22.19.0`; **bundled-runtime is required** |
| Artifact | `1.1.3` / `087d8fb` / `sourceDirty:false` / Diretta SDK 150 / `v2` | Matches `runtime.json` |
| Capabilities | `diretta:true`, `remoteOutput:false` | `remoteOutput:false` does not mean UPnP is unavailable |
| Output scan | Diretta Targets and UPnP Renderers returned; UPnP selected | Multiple outputs coexist correctly |
| Library | 1134 tracks | Scanning and SQLite work |
| Cache | ~12 MiB of covers; other categories empty | Cache is rebuildable |
| Disk | Root filesystem ~91% used, ~10 GB free | Assess cache/download/backup space before production |

Note: the host runs `087d8fb`; this handbook baseline is `5693b3fc`. Layout, ports, and API contracts match, but specific behavior follows the target artifact. Do not treat this on-site result as acceptance of the documentation baseline on that host.

## 3. Pre-install checks

```bash
uname -m
ldd --version | head -1
node --version                 # system package
ss -ltnp | grep 14558 || true
df -h /opt /var/cache "$HOME"
id splayer-atom                # service account
```

Checklist:

- [ ] Target is Linux x86-64.
- [ ] system package has Node `>=22.19.0`; otherwise use bundled.
- [ ] Debian 11 targets use a `package:core:debian11` artifact.
- [ ] Service account exists and can write the install root, `data/`, and cache.
- [ ] 14558 is not occupied by an old `splayer-headless` or another service.
- [ ] For Diretta, run as root and ensure the Target is not occupied by another Host.
- [ ] For UPnP, Core and the Renderer are on a reachable network and the firewall allows random TCP ports.
- [ ] Backup disk has enough space.

## 4. Installation

### 4.1 Extract

The archive content is the install root; there is **no top-level directory**:

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-*-linux-x64.tar.gz -C /opt/splayer-atom-core
```

Layout:

```text
/opt/splayer-atom-core/
├─ app/                 Core JS
├─ renderer/            Web Control
├─ native/              audio-engine.node, streaming-api.node, build.json
├─ node_modules/        better-sqlite3
├─ bin/splayer-atom-core
├─ service/             systemd/OpenRC definitions and installers
├─ docs/core-deployment.md
├─ data/                persistent state (initially empty)
├─ runtime/             bundled only: bin/node
├─ runtime.json
└─ LICENSE
```

### 4.2 Manual verification

Before installing the service, start it manually:

```bash
cd /opt/splayer-atom-core
./bin/splayer-atom-core
```

From another terminal:

```bash
curl -s http://127.0.0.1:14558/api/info
```

Confirm `version`, `commit`, `protocol.version`, and `capabilities`. Then press `Ctrl+C`.

### 4.3 systemd

Create a dedicated service account first (the installer does not create users):

```bash
sudo useradd --system --home /opt/splayer-atom-core --shell /usr/sbin/nologin splayer-atom
sudo chown -R splayer-atom:splayer-atom /opt/splayer-atom-core/data
```

Install the unit:

```bash
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl enable --now splayer-atom-core
```

Diretta requires root:

```bash
sudo ./service/install-systemd.sh --diretta
sudo systemctl enable --now splayer-atom-core
```

Installer behavior:

- must run as root;
- `--user <name>` requires the user to exist;
- rewrites `WorkingDirectory`/`ExecStart` to the actual install root;
- installs to `/etc/systemd/system/splayer-atom-core.service`;
- **only runs `daemon-reload`; it does not enable/start**.

### 4.4 OpenRC (GentooPlayer)

```bash
cd /opt/splayer-atom-core
sudo ./service/install-openrc.sh --user splayer-atom
# or
sudo ./service/install-openrc.sh --diretta

sudo rc-update add splayer-atom-core default
sudo rc-service splayer-atom-core start
```

Installer behavior:

- requires `/sbin/openrc-run` and `rc-update`; refuses systemd hosts;
- writes `/etc/init.d/splayer-atom-core` and `/etc/conf.d/splayer-atom-core`;
- for non-default install roots, rewrites the literal `command=` path;
- preserves user-added lines in conf.d;
- does not `rc-update add` or start automatically;
- if a GentooPlayer probe exists, runs it and prints the result; a `NOT INSTALLED` result produces a WARNING.

### 4.5 First access

Open:

```text
http://<Core host IP>:14558
```

For domain/reverse-proxy access, set `ATOM_ALLOWED_HOSTS` and preserve the original Host header.

## 5. Directories, permissions, and data

### 5.1 Directories

| Path | Contents | Persistence | Backup |
| --- | --- | --- | --- |
| `<install root>/data/` | Config, database, plugins, migration backups | Authoritative | Required |
| `data/config/settings.json` | Core settings | Authoritative | Required |
| `data/config/qobuz.json` | Qobuz credentials | Authoritative | Required (encoded plaintext) |
| `data/config/tidal.json` | TIDAL credentials | Authoritative | Required |
| `data/config/listenbrainz.json` | ListenBrainz token | Authoritative | Required |
| `data/config/streaming.json` | Self-hosted server config | Authoritative | Required |
| `data/database/library.db` | Library, queue, stats, downloads, lyric cache | Authoritative | Required |
| `data/database/listenbrainz-outbox.db` | LB outbox | Authoritative | Recommended |
| `data/plugins/` | Plugin scripts, data, manifest | Authoritative | Recommended |
| `data/backups/migration-*` | Pre-migration snapshots | Diagnostic | Retain per policy |
| `~/.cache/splayer-atom/` | Image/song cache, download temp | Rebuildable | Not required |
| `~/Music/SPlayer Atom Core/` | Default download directory | User media | User-managed |

### 5.2 Permissions

Recommended:

```bash
sudo chown -R splayer-atom:splayer-atom /opt/splayer-atom-core/data
sudo chmod 700 /opt/splayer-atom-core/data
sudo find /opt/splayer-atom-core/data -type f -exec chmod 600 {} +
```

Notes:

- Credential files are written with `0600`; `runtimeSecretCodec` is `plain:<base64>`, not encryption.
- Third-party cookies in `account_sessions` are plain JSON in SQLite; tighten database file permissions.
- Migration backups contain `config/` and database snapshots and are equally sensitive.
- The service account also needs ALSA device access (usually the `audio` group) and cache write access.

## 6. Configuration

### 6.1 Runtime environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ATOM_SERVER_PORT` | `14558` | Listen port; invalid values fall back to 14558 |
| `ATOM_ALLOWED_HOSTS` | empty | Comma-separated additional Host allowlist |
| `ATOM_DATA_DIR` | packaged `<install root>/data` | Data root; changing it does not migrate data |
| `ATOM_CACHE_DIR` | `$XDG_CACHE_HOME/splayer-atom` or `~/.cache/splayer-atom` | Cache root |
| `ATOM_MUSIC_DIR` | `~/Music` | Parent of the default download directory |
| `ATOM_NODE_BIN` | empty | Preferred Node for the launcher |
| `ATOM_WEB_DEV_URL` | empty | Development only: same-host any-port Origin and CORS |
| `ATOM_APP_NAME` | `SPlayer Atom Core` | Application name |
| `ATOM_APP_VERSION` | `1.0.0` or `runtime.json.atomVersion` | Version override |
| `ATOM_COMMIT` | `runtime.json.atomCommit` or `unknown` | Commit override |
| `ATOM_SOURCE_DIRTY` | `runtime.json.sourceDirty` | Only `"1"` is true |
| `ATOM_NATIVE_DIR` | `<install root>/native` | Native module directory |
| `ATOM_RENDERER_DIR` | `<install root>/renderer` | Web static directory |
| `ATOM_RESOURCES_DIR` | install root (launcher) | `runtime.json` lookup root |
| `ATOM_TEMP_DIR` | `os.tmpdir()` | TIDAL materialization only |
| `NODE_ENV` | launcher sets `production` | Affects packaged flag |
| `QOBUZ_*` | empty | Qobuz credential override |
| `TIDAL_*` | empty | TIDAL credential override |

Notes:

- `QOBUZ_*` / `TIDAL_*` override UI login results and may appear in the process environment. Prefer UI login plus 0600 files in production.
- Changing `ATOM_DATA_DIR` does not migrate old data; copy manually.
- Packaged startup sets `ATOM_CACHE_DIR` to the XDG cache; `cache.dir` in settings takes precedence.

### 6.2 systemd configuration

```bash
sudo systemctl edit splayer-atom-core
```

Example:

```ini
[Service]
Environment=ATOM_SERVER_PORT=14558
Environment=ATOM_ALLOWED_HOSTS=music.example.com
Environment=ATOM_DATA_DIR=/srv/splayer-atom/data
```

Apply:

```bash
sudo systemctl daemon-reload
sudo systemctl restart splayer-atom-core
```

### 6.3 OpenRC configuration

Edit `/etc/conf.d/splayer-atom-core`:

```sh
# SPLAYER_ATOM_ROOT="/opt/splayer-atom-core"   # non-default install root
# command_user="splayer-atom"
export ATOM_SERVER_PORT=14558
export ATOM_ALLOWED_HOSTS=music.example.com
```

OpenRC sources conf.d before running the init script.

### 6.4 Reverse proxy

Core supports same-origin requests only. The proxy must:

- preserve the original `Host`: `proxy_set_header Host $host;`
- support WebSocket Upgrade;
- include the public domain in `ATOM_ALLOWED_HOSTS`;
- preferably add TLS and authentication.

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name music.example.com;

    location / {
        proxy_pass http://127.0.0.1:14558;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

If the proxy rewrites Host to `127.0.0.1` while the browser Origin is the public domain, `requestGuard` returns `cross-origin request rejected`.

## 7. Service lifecycle

### 7.1 systemd

```bash
sudo systemctl start splayer-atom-core
sudo systemctl stop splayer-atom-core
sudo systemctl restart splayer-atom-core
sudo systemctl status splayer-atom-core
sudo systemctl enable splayer-atom-core
sudo systemctl disable splayer-atom-core
journalctl -u splayer-atom-core -n 200 --no-pager
journalctl -u splayer-atom-core -f
```

Unit highlights:

- `Restart=on-failure`, `RestartSec=3`
- `LimitRTPRIO=95`, `LimitMEMLOCK=infinity`
- `Environment=NODE_ENV=production`

### 7.2 OpenRC

```bash
sudo rc-service splayer-atom-core start
sudo rc-service splayer-atom-core stop
sudo rc-service splayer-atom-core restart
rc-service splayer-atom-core status    # 0=started, 3=stopped
sudo rc-update add splayer-atom-core default
sudo rc-update del splayer-atom-core default
tail -n 100 /var/log/splayer-atom-core.log
tail -n 100 /var/log/splayer-atom-core.err.log
```

OpenRC uses `supervise-daemon` with bounded restarts:

- `respawn_delay=5`
- `respawn_period=120`
- `respawn_max=10`

`respawn_max=0` means unlimited restarts and can hide a binary that never starts as a `status=started` crash loop. Do not configure it that way.

### 7.3 Stop semantics

SIGTERM/SIGINT only flush settings and exit. They do not gracefully close:

- the UPnP media server
- the plugin host child
- the ListenBrainz child
- Direct/UPnP temp files
- playback statistics

These rely on process-group exit and next-start cleanup. If `/tmp/splayer-atom-*` remains after a stop, clean it by PID directory.

## 8. Audio output operations

### 8.1 ALSA

- Core lists only real hw playback PCM endpoints; no `default`/`plughw`/`softvol`.
- Device IDs are `alsa:hw:CARD=<card_id>,DEV=<n>`.
- Processed: mono/stereo only; EQ/loudness/speed; prefer the source rate; no ALSA resampling.
- Direct: preserves valid bits; integers never become float; native DSD; unsupported representations fail explicitly.
- At startup, ALSA hw is auto-selected only when there is exactly one candidate; otherwise select in Web.

Checks:

```bash
aplay -l
cat /proc/asound/cards
curl -s http://127.0.0.1:14558/api/output/devices
```

### 8.2 Diretta

Prerequisites:

1. The artifact includes Diretta (`/api/info.capabilities.diretta === true`).
2. Core runs as root (`install-systemd.sh --diretta` or `install-openrc.sh --diretta`).
3. SDK 148 and the CPU variant match the target.
4. The Target is exclusively available and not held by another Host.
5. The source is lossless integer PCM or native DSD.

Constraints:

- no resampling, mixing, normalization, EQ, non-unity gain, fades, speed/pitch changes, DoP, or DSD-to-PCM;
- the staged next track must match the current wire format;
- PCM ↔ Native DSD cannot switch inside one runtime;
- multichannel, Float32, and lossy sources are rejected;
- rejection is expected behavior, not a missing fallback.

Checks:

```bash
curl -s http://127.0.0.1:14558/api/info | grep -E 'diretta|direttaSdkRelease'
cat /opt/splayer-atom-core/native/build.json
dmesg | grep -i 'invalid opcode'    # SIGILL: CPU variant mismatch
```

### 8.3 UPnP

- Core-owned single-Renderer path; one selected Renderer at a time.
- Discovery uses SSDP (239.255.255.250:1900); media is served over a temporary Core HTTP port.
- No gapless; each track reloads a URI; end detection is 1-second polling plus a near-end heuristic.
- CUE/SACD generate temporary WAV/DSF files and require disk space.
- Multichannel and non-integer-lossless CUE are rejected.

Checks:

```bash
curl -s http://127.0.0.1:14558/api/output/devices
ss -ltnp | grep node     # temporary media port
```

The firewall must allow the Renderer to reach Core's random TCP ports and allow Core's SSDP multicast.

### 8.4 Real-time priority

systemd unit:

```ini
LimitRTPRIO=95
LimitMEMLOCK=infinity
```

OpenRC `start_pre()`:

```sh
ulimit -l unlimited
ulimit -r 95
```

Failure does not block startup, but the output writer falls back to normal priority. If you hear dropouts, verify these limits first.

## 9. Library operations

### 9.1 Scanning

- One scan at a time per Core.
- Incremental scans skip unchanged files by mtime/size.
- Deletion detection covers only the scanned scope; unreachable directories are not treated as deletions.
- Scan progress is memory-only and lost on restart.
- On completion, Core publishes a `libraryChanged` revision, not the full library.

Paths:

- Web: Settings → Local Library → Add directory → Scan.
- API: `POST /api/library/scan`, `GET /api/library/scan-progress`, `POST /api/library/scan/cancel`.

### 9.2 Removing a directory

`DELETE /api/library/scan-dirs`:

- deletes database records for that directory;
- cancels a running scan;
- removes related pins;
- **does not delete music files**.

### 9.3 Large libraries

- SQLite's synchronous API occupies the Node event loop; large queries or queue writes can cause short stalls.
- Every session publish serializes the whole queue into SQLite; large queues with frequent edits amplify writes.
- Folder search traverses at most 100,000 entries and returns `truncated:true` beyond that.

## 10. Online accounts and credentials

### 10.1 Login methods

| Provider | Method | Credential location |
| --- | --- | --- |
| NetEase | QR / manual Cookie | `account_sessions` |
| QQ Music | QQ/WeChat QR / manual Cookie | `account_sessions` |
| Kugou | QR / manual Cookie | `account_sessions` |
| Qobuz | Browser OAuth / token | `config/qobuz.json` |
| TIDAL | PKCE callback / device code / token | `config/tidal.json` |
| Self-hosted streaming | Username/password | `config/streaming.json` |

### 10.2 Credential protection

- Files are `0600`; `data/` should be `0700`.
- `runtimeSecretCodec` is base64, not encryption; backups are plaintext-equivalent.
- `QOBUZ_*`/`TIDAL_*` environment variables override UI login; use them carefully in production.
- Do not put `data/` in a publicly accessible directory or an ordinary cloud-sync folder.

### 10.3 Login expiry

- NetEase: `NETEASE_LOGIN_EXPIRED`; re-scan or re-enter Cookie.
- QQ/Kugou: `PROVIDER_LOGIN_REQUIRED` or entitlement errors; log in again.
- Qobuz/TIDAL: re-authorize when refresh fails; TIDAL device code is AAC-only, while official PKCE supports lossless.
- Self-hosted streaming: 401/403 invalidates the session and retries once; persistent failure indicates address/account/network issues.

## 11. Cache, downloads, plugins, ListenBrainz

### 11.1 Cache

- Default cache root: `~/.cache/splayer-atom`.
- Subdirectories: `covers/`, `artists/`, `backgrounds/`, `songs/`, `downloads-tmp/`.
- Song cache is off by default; when enabled, set a limit (default 10 GB, 0 = unlimited).
- Image cache has no automatic limit; clean it periodically.
- Switching cache directories requires an empty target and clears old file caches; database lyric caches are unaffected.

Inspect:

```bash
curl -s http://127.0.0.1:14558/api/cache/stats
du -sh ~/.cache/splayer-atom/*
```

Clean:

- Web: Settings → Local & Cache.
- API: `POST /api/cache/clear`, `POST /api/cache/clear-all`.

### 11.2 Downloads

- Disabled by default; enable in settings.
- Default directory: `~/Music/SPlayer Atom Core`.
- Serial downloads; deduplicated by track and quality; no resume.
- Temp files in `<cache>/downloads-tmp`; cleaned at startup; unfinished tasks marked `interrupted`.
- Deleting a task does not delete completed music files.

Inspect:

```bash
curl -s http://127.0.0.1:14558/api/download/tasks
df -h ~/Music
```

### 11.3 Plugins

- Installed under `data/plugins/`.
- Host crashes trigger 2s → 8s → 30s backoff; after three failures plugins become error.
- Plugins share one host event loop; a long-blocking plugin stalls the others.
- Install only trusted HTTPS scripts; the install URL is a remote-code entry point.
- Plugin logs go to Core stdout, not a separate file.

Inspect:

```bash
curl -s http://127.0.0.1:14558/api/plugins
```

### 11.4 ListenBrainz

- Disabled by default; when disabled, no background work occurs.
- When enabled, token validation and submission run in a child process; outbox at `data/database/listenbrainz-outbox.db`.
- 401 → `auth_error`; 408/429/5xx → exponential backoff up to 30 minutes; other 4xx → `dead`.
- Child restarts 5 seconds after a crash; no heartbeat, so a hung child is not restarted.
- Threshold: `min(track duration / 2, 240 seconds)`.

Inspect:

```bash
curl -s http://127.0.0.1:14558/api/listenbrainz/status
```

## 12. Backup, upgrade, rollback, uninstall

### 12.1 Backup

Minimum:

```bash
sudo systemctl stop splayer-atom-core
sudo tar -czf /backup/splayer-atom-data-$(date +%F).tar.gz \
  -C /opt/splayer-atom-core data
sudo systemctl start splayer-atom-core
```

Notes:

- SQLite uses WAL; copying only `library.db` while running can miss WAL. Stopped-service backup is safest.
- Migration backups under `data/backups/migration-*` contain DB snapshots and config; they do not replace a full old-version rollback copy.
- Backups contain plaintext-encoded credentials; encrypt and restrict them.

### 12.2 Upgrade

1. Stop and confirm:

```bash
sudo systemctl stop splayer-atom-core
sudo systemctl is-active splayer-atom-core
```

2. Preserve the complete old installation (including old `data/`):

```bash
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.rollback
```

3. Extract the new artifact:

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf <new artifact>.tar.gz -C /opt/splayer-atom-core
```

4. Replace the empty `data/` with a copy of the old one:

```bash
sudo rm -rf /opt/splayer-atom-core/data
sudo cp -a /opt/splayer-atom-core.rollback/data /opt/splayer-atom-core/data
```

5. Reinstall the service definition and start:

```bash
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
# or --diretta
sudo systemctl start splayer-atom-core
```

6. Accept:

```bash
curl -s http://127.0.0.1:14558/api/info
curl -s http://127.0.0.1:14558/api/session
curl -s http://127.0.0.1:14558/api/library/count
curl -s http://127.0.0.1:14558/api/cache/stats
```

Principles:

- Do not extract over a running installation.
- Copy old `data/` with `cp -a`; do not move it.
- An old binary must never read data migrated by a new Core.
- Core rejects schemas newer than it supports; do not delete the database to bypass this.

### 12.3 Rollback

```bash
sudo systemctl stop splayer-atom-core
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl start splayer-atom-core
```

Keep the failed installation and migration backups for diagnosis.

OpenRC equivalent:

```bash
sudo rc-service splayer-atom-core stop
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
cd /opt/splayer-atom-core
sudo ./service/install-openrc.sh --user splayer-atom
sudo rc-service splayer-atom-core start
```

### 12.4 Uninstall

The repository provides no uninstall script; these steps follow the existing service assets.

systemd:

```bash
sudo systemctl disable --now splayer-atom-core
sudo rm -f /etc/systemd/system/splayer-atom-core.service
sudo systemctl daemon-reload
# irreversible: remove installation and data
# sudo rm -rf /opt/splayer-atom-core
```

OpenRC:

```bash
sudo rc-service splayer-atom-core stop
sudo rc-update del splayer-atom-core default
sudo rm -f /etc/init.d/splayer-atom-core /etc/conf.d/splayer-atom-core
# irreversible: remove installation and data
# sudo rm -rf /opt/splayer-atom-core
```

Also clean as needed:

- `~/.cache/splayer-atom/`
- `/tmp/splayer-atom-*`
- the service account (if unused)
- backups containing `data/`

## 13. Inspection checklist

### 13.1 Daily/weekly

- [ ] Service status: `systemctl status` or `rc-service status`.
- [ ] Port listening: `ss -ltnp | grep 14558`.
- [ ] `/api/info` version/commit unchanged unexpectedly.
- [ ] `/api/session` queue sane.
- [ ] `/api/output/devices` target present.
- [ ] `/api/cache/stats` cache growth controlled.
- [ ] Disk: install root, cache, download directory.
- [ ] Logs free of schema rejection, port conflicts, crash loops.
- [ ] OpenRC: size/content of `/var/log/splayer-atom-core.err.log`.

### 13.2 Monthly

- [ ] Back up `data/` and verify readability.
- [ ] Clean expired `data/backups/migration-*`.
- [ ] Review plugin versions and sources.
- [ ] Verify online provider logins.
- [ ] Check ListenBrainz `pending`/`dead`.
- [ ] Assess cache and download capacity.

## 14. Troubleshooting

### 14.1 Startup failures

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `Node runtime not found` | system package has no Node, or `ATOM_NODE_BIN` is wrong | Install Node `>=22.19` or use bundled |
| Node too old | `<22.19.0` | Upgrade Node |
| `EADDRINUSE` | 14558 occupied | `ss -ltnp \| grep 14558`; stop old service or change port |
| `EACCES` | Service user lacks `data/` or cache permissions | `chown`/`chmod` |
| `ERR_DLOPEN_FAILED` / `GLIBC_2.xx not found` | Artifact/glibc mismatch | Use a Debian 11 build |
| Schema newer than supported | Old binary reading new data | Restore the full old install |
| Diretta not root | Permission check | Install with `--diretta` |
| `status=started` but API unreachable | OpenRC unlimited restart or dead child | Check err.log; ensure `respawn_max>0` |

### 14.2 Browser cannot open / 403

| Symptom | Cause | Action |
| --- | --- | --- |
| Connection refused | Not listening/firewall | Check service and port |
| `untrusted host` | Domain not allowlisted | `ATOM_ALLOWED_HOSTS` |
| `cross-origin request rejected` | Proxy rewrites Host | Preserve original Host |
| `opaque origin rejected` | `file://`/sandbox iframe | Use normal http(s) |
| WS fails | Proxy lacks Upgrade | Configure WebSocket forwarding |
| Blank page | Static assets 404 | Verify `renderer/` and version match |

### 14.3 Playback failures

| Error | Meaning | Action |
| --- | --- | --- |
| `OUTPUT_DEVICE_REQUIRED` | No output selected | Select ALSA/Diretta/UPnP in Web |
| `DEVICE_NOT_FOUND` | Device disappeared | Check `aplay -l`/Renderer, reselect |
| `OUTPUT_FORMAT_UNSUPPORTED` | Output rejects format | Change output or source; Diretta has no fallback |
| `NETWORK_ERROR` / `NETWORK_TIMEOUT` | Source network failure | Check network/proxy/provider |
| `URL_RESOLVE_FAILED` | Official and plugin both failed | Check login/entitlement/plugin |
| `PROVIDER_VIP_REQUIRED` / `NETEASE_VIP_REQUIRED` | Membership entitlement | Use an entitled account or another source |
| `FILE_DECODE_ERROR` | Corrupt file/cache | Rescan; cache invalidates and re-downloads |
| `outputFailed` / `outputStalled` | Output stream failed/stalled | Playback pauses; reselect output or reinit |
| Stops after repeated failures | Hit `min(5, queue length)` | Inspect the error code; device errors are not skipped |

### 14.4 Diretta

| Symptom | Cause | Action |
| --- | --- | --- |
| No Diretta device | Artifact lacks SDK | `/api/info.capabilities.diretta` |
| Permission error selecting Diretta | Not root | Use `--diretta` |
| `SIGILL` / `invalid opcode` | CPU variant mismatch | Rebuild with a lower variant (v2 is most conservative) |
| Connection failure | Target occupied/network | Exclusively reserve Target; check link |
| Format rejected | Non-lossless integer PCM / wire-format mismatch | Change source; this is by design |
| No sound but state is playing | Volume/EQ locked at 1 | Check DAC/preamp, not Core volume |

### 14.5 UPnP

| Symptom | Cause | Action |
| --- | --- | --- |
| Empty device list | SSDP blocked/firewall | Check multicast and network |
| Discovered but cannot play | Renderer cannot pull media | Allow Core's random TCP ports |
| Playback interrupts | Renderer format incompatibility | Check Renderer compatibility |
| No auto-next | Polling did not detect near-end | Check duration/position; UPnP has no gapless |
| CUE/SACD fails | Multichannel/non-integer-lossless/missing track | Use supported formats or another output |

### 14.6 Data and upgrades

| Symptom | Cause | Action |
| --- | --- | --- |
| Schema rejection at startup | Data from a newer version | Roll back the full old install |
| Migration backups consume space | No automatic cleanup | Define retention manually |
| Library empty after changing `ATOM_DATA_DIR` | Old data not migrated | Copy `data/` manually |
| Settings lost after upgrade | Old `data/` not copied | `cp -a` from the rollback directory |
| Cache directory switch fails | Target not empty | Use an empty directory or clean it first |

### 14.7 Plugins and ListenBrainz

| Symptom | Cause | Action |
| --- | --- | --- |
| Plugin `error` | Load/runtime failure or host crash limit | Read the plugin card; disable/reinstall |
| All plugins unavailable | Host crashed | Wait for 2/8/30s restart; check logs |
| Plugin stalls playback | Shared event loop blocked | Disable the suspect plugin |
| LB `auth_error` | Token invalid | Rebind |
| LB `dead` grows | 4xx payload error | Clear outbox; inspect payload |
| LB `pending` does not drop | Network/server failure | Check outbound 443; wait for backoff |

## 15. Security hardening

### 15.1 Network boundary

- Never expose 14558 directly to the internet.
- Firewall to trusted LAN only:
  ```bash
  sudo ufw allow from 192.168.0.0/16 to any port 14558 proto tcp
  ```
- For remote access, use a VPN or a TLS + authenticated reverse proxy.
- Core has no TLS; do not send credentials over plaintext HTTP across untrusted networks.

### 15.2 Host permissions

- Use a dedicated non-root user for ordinary ALSA, in the `audio` group.
- Diretta requires root; isolate the host and avoid running other services in the same root session.
- `data/` 0700, files 0600.
- Encrypt backups.

### 15.3 Plugins and online content

- Install only trusted plugins.
- Plugins can access the network; grant only the permissions they need.
- Do not expose `data/plugins/` to other users.

### 15.4 Known exposures

- `/api/filesystem/directories` can list host directories.
- `/api/player/read-lyric` can read any file with a matching extension that the Core process can read.
- `/api/library/scan-dirs` accepts arbitrary strings without validating directories.
- The `coverPath` for tag writing is not restricted to library roots.

These are acceptable under the "trusted LAN, single user" model but must not be exposed on untrusted networks.

## 16. Environment vs code boundary (R10)

Operators see logs and status, not source. Treat these as environment-first:

| Symptom | Environment side | Code side |
| --- | --- | --- |
| Exits immediately at startup | Node version, port, permissions, schema, missing libraries | Startup orchestration, migration bug |
| No sound | Output device, DAC, cable, permission, Target occupancy | Decoding, format negotiation, output selection |
| Diretta failure | Not root, CPU variant, SDK, Target | Format checks, staging logic |
| UPnP failure | Network, firewall, Renderer compatibility | Discovery, media server, end detection |
| 403 | Host/Origin/reverse proxy | Guard rules |
| Stutter/dropouts | CPU, realtime limits, memory lock, DAC buffer | DSP/buffer/threads |
| Online playback failure | Account, entitlement, network, provider change | Resolver, plugin, error classification |
| Library missing | Directory permissions, mount, NAS reachability | Scan/deletion detection |
| Disk growth | Cache/download/backup policy | Eviction logic |

Order:

1. Confirm service, port, version, logs.
2. Confirm output device and format.
3. Confirm network/account/permissions.
4. Only then suspect code; preserve `/api/info`, logs, reproduction steps, and artifact identity.

## 17. Acceptance checklist

### 17.1 Software

- [ ] `/api/info` version/commit/protocol/capabilities match the artifact.
- [ ] Web root page opens.
- [ ] `/api/session`, `/api/status`, `/api/output/devices` work.
- [ ] WebSocket connects and receives `hello`.
- [ ] Queue/settings/library survive restart.
- [ ] SIGTERM exits with code 0.
- [ ] Migration backup exists and is readable (if a migration occurred).

### 17.2 Hardware

- [ ] ALSA Processed: common formats, seek, speed/pitch, EQ.
- [ ] ALSA Direct: PCM/DSD, format rejection, switching.
- [ ] Diretta: PCM/DSD, exact format, CUE gapless, seek, long run.
- [ ] UPnP: common formats, CUE, SACD, DSD, output switching, long-run resources.
- [ ] Output switch failure rollback.
- [ ] Auto-next and repeated-failure stop.

### 17.3 Accounts

- [ ] NetEase, QQ, Kugou, Qobuz, TIDAL: login, search, playback, lyrics.
- [ ] Entitlement/trial/purchase errors classified correctly.
- [ ] Self-hosted streaming: connect, sync, search, playback, lyrics.

## 18. Appendix

### 18.1 Common commands

```bash
# Service
systemctl status splayer-atom-core
journalctl -u splayer-atom-core -n 200 --no-pager
rc-service splayer-atom-core status
tail -n 100 /var/log/splayer-atom-core.err.log

# Ports/processes
ss -ltnp | grep 14558
ps -ef | grep splayer-atom-core

# API
curl -s http://127.0.0.1:14558/api/info
curl -s http://127.0.0.1:14558/api/status
curl -s http://127.0.0.1:14558/api/session
curl -s http://127.0.0.1:14558/api/output/devices
curl -s http://127.0.0.1:14558/api/cache/stats
curl -s http://127.0.0.1:14558/api/download/tasks
curl -s http://127.0.0.1:14558/api/plugins
curl -s http://127.0.0.1:14558/api/listenbrainz/status

# Disk
du -sh /opt/splayer-atom-core/data
du -sh ~/.cache/splayer-atom
df -h

# Artifact identity
cat /opt/splayer-atom-core/runtime.json
cat /opt/splayer-atom-core/native/build.json
sha256sum splayer-atom-core-*.tar.gz

# glibc symbols
readelf --version-info native/audio-engine.node \
  | grep -oE 'GLIBC_[0-9.]+' | sort -V | tail -1

# CPU variant errors
dmesg | grep -i 'invalid opcode'
```

### 18.2 Data files

```text
data/config/settings.json
data/config/qobuz.json
data/config/tidal.json
data/config/listenbrainz.json
data/config/streaming.json
data/database/library.db
data/database/listenbrainz-outbox.db
data/plugins/manifest.json
data/plugins/scripts/
data/plugins/data/
data/backups/migration-*/
```

### 18.3 Related documents

- [Core deployment and upgrades](../core-deployment.md)
- [GentooPlayer / OpenRC](../gentooplayer-openrc.md)
- [Build and packaging](../build-and-packaging.md)
- [CPU variants](../../cpu-variants.md) (Chinese only)
- [Hardware release acceptance](../../hardware-release-checklist.md) (Chinese only)
- [Diretta troubleshooting](../../troubleshooting/diretta-headless-troubleshooting.md) (Chinese only)
- [Project Book](./01-project.md)
- [API Reference](./05-api.md)
