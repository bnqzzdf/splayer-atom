# splayer-atom-core 1.1.0 · Debian 11 build compatibility (1.1.0-era record)

> Last updated: 2026-09-28

> This document explains **why the delivered artifact is Debian 11 compatible**, how the compatibility
> was measured, and what was done to achieve it.
> It is produced directly by the build and verification process; every number below is a measured value.
>
> **Scope note**: this document is a **1.1.0-era record** — the artifact fingerprint, build environment,
> deployment state, and verification results all come from the delivery around 2026-09-23. The current
> `package.json` version is already **1.1.2**, and the artifact naming rule has changed since
> (the filename in §1 and the rule example in §5 are labeled under the then-current and the current
> convention respectively). For the current rule, see
> [Build and packaging](./build-and-packaging.md) and `scripts/atom/core-artifact-name.ts`.

---

## 1. Artifact fingerprint

| Item                   | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Artifact file          | `splayer-atom-core-1.1.0-20260923-150342-bundled-linux-x64.tar.gz` |
| SHA256                 | `b5ae8529430cc6d5a027ca41127eb31750f06f559961337b824dd1b8770bb231` |
| Size                   | 56,837,764 bytes                                                   |
| atomCommit             | `07c2442d5f688fcf9e5050ca6bce9879f855abcb`                         |
| sourceDirty            | `false` (the change was committed as `07c2442`)                    |
| Diretta CPU variant    | `v3`                                                               |
| Node reference version | 24.18.0                                                            |
| Build date             | 2026-09-23                                                         |

> The artifact name in the table is **the filename actually produced at the time**, in the format
> `<version>-<YYYYMMDD><HHMMSS>-...`, which had not yet split the commit, date, and time into separate
> segments. Under the current rule (`scripts/atom/core-artifact-name.ts:117-125`) the same artifact
> should be named `splayer-atom-core-1.1.0-07c2442d-20260923-150342-bundled-linux-x64.tar.gz`. §5
> gives the full description of the current rule at its end.

---

## 2. glibc compatibility: measured conclusion

The build container is **Debian 11 (bullseye), glibc 2.31**. Measured maximum glibc symbol requirement
of the three native components inside the artifact:

| Component                                              | Highest glibc requirement | Verdict (threshold 2.31) |
| ------------------------------------------------------ | ------------------------- | ------------------------ |
| `native/audio-engine.node`                             | **GLIBC_2.30**            | ✅ pass                  |
| `native/streaming-api.node`                            | **GLIBC_2.30**            | ✅ pass                  |
| `node_modules/better-sqlite3/prebuilds/linux-x64.node` | **GLIBC_2.29**            | ✅ pass                  |

**Conclusion: the artifact runs on Linux x86_64 with glibc ≥ 2.30, which covers Debian 11 and later target machines.**

The build pipeline has a hard check built in: any component requiring more than `GLIBC_2.31` makes the
build `exit 1` and refuse to produce a package, so "Debian 11 compatible" is not a verbal promise but a
mandatory gate at build time.

Reference: the deployment target `10.0.0.190` (GentooPlayer) measures glibc **2.43**, which is fully
backward compatible with this artifact.

---

## 3. Build environment (reproducible)

| Component       | Version / location                                |
| --------------- | ------------------------------------------------- |
| Build host      | `192.168.101.133` (Docker 29.7.2)                 |
| Base image      | `debian:11` (bullseye)                            |
| glibc in image  | 2.31                                              |
| Node.js         | 24.18.0                                           |
| pnpm            | 11.5.2                                            |
| Rust            | 1.98.1 (stable, minimal profile)                  |
| Diretta SDK     | `DirettaHostSDK_150` (`/root/DirettaHostSDK_150`) |
| Build image tag | `splayer-atom-debian11-builder`                   |

> ⚠️ Docker on that host **has no bridge network** (no `docker0`),
> so both image builds and container runs must explicitly pass `--network host`, otherwise you get
> `network bridge not found`.

---

## 4. The two key changes made to achieve compatibility

### 1) glibc < 2.38 compatibility layer (required, otherwise the artifact will not start at all)

**Problem**: the ACQUA static libraries of Diretta SDK 150 were compiled on a system with glibc ≥ 2.38,
and two of their object files reference the C23 integer-parsing functions:

- `IPAddress.o` → `__isoc23_strtol`
- `FileInf.o` → `__isoc23_strtoll`

These two symbols are provided by libc only from glibc 2.38 onward. On Debian 11 the linked
`audio-engine.node` **fails to load** with `undefined symbol: __isoc23_strtol` (`ERR_DLOPEN_FAILED`).
Every glibc variant in the SDK (15v3/16v3/16v4/16zen4) has this problem; only the musl variants do
not — but musl is ABI-incompatible with glibc, so it cannot be used for a glibc target.

**What was done**: a new `native/diretta-sys/src/glibc_compat.c` provides **weak symbols** that forward
to the standard `strtol` / `strtoll` when glibc < 2.38.

**Why it is safe**:

1. Only the configuration and IP-parsing paths (`IPAddress.o`, `FileInf.o`) reference these two
   symbols, so it is **not involved in audio DSP**; they parse dotted-decimal IPs and ordinary decimal
   numbers, and **never use the `0b` binary prefix added in C23**, so the forwarding is semantically
   equivalent.
2. It uses a `weak` definition: on platforms with glibc ≥ 2.38 the file compiles to an empty object
   and defines no symbol; even if both exist at once, libc's strong symbol takes precedence, so there
   is no conflict.
3. The change is confined to the `diretta-sys` build script and does not affect how other components
   are built.

**Risk and boundary**: this is a compatibility workaround for a third-party prebuilt library.
If Diretta later publishes ACQUA libraries compiled against an older glibc, this compatibility layer
should be removed.

### 2) tokio `macros` feature (found at build time)

`streaming-api`'s OAuth implementation uses `tokio::select!` (to make a new login stop the old
listener), and that macro requires tokio's `macros` feature. Because `dev-dependencies` happens to
enable `macros` as well, running only `cargo test` will not expose its absence; you must use
`cargo build --release` (which excludes dev-deps) to cover the production feature set. It has been
added in `native/streaming-api/Cargo.toml`, with a comment explaining it.

---

## 5. Reproduction steps

The repository already has a packaged entry point, so there is no need to assemble Docker commands by
hand:

```bash
# build the image -> build inside the container -> produce the debian11 artifact, all in one command
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v2

# without Diretta (ALSA-only)
pnpm package:core:debian11 --without-diretta
```

The host-side driver is `scripts/atom/build-debian11-bundled.sh`, the in-container script is
[`docker/atom-debian11/build.sh`](https://github.com/bnqzzdf/splayer-atom/blob/dev/docker/atom-debian11/build.sh),
and the image definition and usage are in [`docker/atom-debian11/README.md`](https://github.com/bnqzzdf/splayer-atom/blob/dev/docker/atom-debian11/README.md).

The core commands actually executed inside the container:

```sh
pnpm install --frozen-lockfile --store-dir /root/.local/share/pnpm/store
# better-sqlite3 must be compiled from source to match Debian 11's glibc
sqlite_dir=$(dirname "$(node -p "require.resolve('better-sqlite3/package.json')")")
npm --prefix "$sqlite_dir" run build-release
cp "$sqlite_dir/build/Release/better_sqlite3.node" "$sqlite_dir/prebuilds/linux-x64.node"

DIRETTA_SDK_ROOT=/root/DirettaHostSDK_150 DIRETTA_CPU_VARIANT=v3 \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v3 --bundle-node
```

The artifact name follows the rule in `scripts/atom/core-artifact-name.ts:117-125`:

```text
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz
```

Meaning of each segment:

- `<version>`: the version number in `package.json`.
- `<commit>`: the first 8 characters of `git rev-parse HEAD` (or `commit=` of `SOURCE_COMMIT`
  inside a source delivery package), matching `runtime.json.atomCommit` inside the artifact, so
  "given a tar, you know which commit it came from".
- `<YYYYMMDD>` / `<HHMMSS>`: packaging date and time, which can be pinned respectively with
  `ATOM_BUILD_DATE` / `ATOM_BUILD_TIME`.
- `[-diretta-<variant>]`: present only in builds with Diretta, where `<variant>` is `v2` / `v3` / `v4` /
  `zen4`; ALSA-only builds without Diretta have no such segment.
- The final segment `<flavor>` is `bundled` or `system`; the example here is `bundled`.

Under the current rule, the artifact delivered in this document should be named
`splayer-atom-core-1.1.0-07c2442d-20260923-150342-bundled-linux-x64.tar.gz`; what was actually
produced at the time was the old-format name in the table in §1 (the rule then had not yet split the
commit, date, and time apart).

---

## 6. Deployment and verification results (target machine 10.0.0.190)

The deployment kept the runtime data directory `data/` (config, database) and replaced only the
artifact itself.

**Post-deployment state**

```
commit=8cd2e2a6 dirty=True 平台位=5/5 [netease,qqmusic,kugou,qobuz,tidal]
rc-service splayer-atom-core status → started
```

> **How to read this: the two commits are not the same object, and they are not a typo either.**
>
> - **The artifact's own identity** (§1): `atomCommit=07c2442d5f688fcf9e5050ca6bce9879f855abcb`,
>   `sourceDirty=false`, taken from `runtime.json` inside the package, meaning this tar was built from
>   the clean working tree of `07c2442d`.
> - **The runtime/working-tree state when deployed to the target machine**: `commit=8cd2e2a6 dirty=True`
>   above describes the commit and dirty state of the working tree on the target machine at deployment
>   time, and is unrelated to the release package contents.
>
> Both can hold at the same time: the artifact was built from `07c2442d` and deployed to a target
> machine sitting at `8cd2e2a6` with working-tree changes. To determine which commit an artifact came
> from, always rely on `runtime.json.atomCommit` inside the artifact; the target machine's working-tree
> state only says what uncommitted changes exist on that machine.

**Qobuz OAuth automated verification (everything except a real browser login is covered)**

> Note: the Qobuz OAuth content below and the `state` policy in §7 are an **appendix/historical record**;
> the topic does not match the filename "Debian 11 build compatibility", and the content overlaps with
> [Qobuz OAuth plan](./qobuz-oauth-plan.md). The original record is kept here for traceability; if the
> documentation is reorganized later, this part is better moved into `docs/qobuz-oauth-plan.md` or a
> separate acceptance record, rather than left in this document.

| #   | Check                                                                                               | Result |
| --- | --------------------------------------------------------------------------------------------------- | ------ |
| 1   | API registered (negative control `Unsupported Qobuz API`)                                           | ✅     |
| 2   | `auth_oauth_start` return shape (url/port/redirectUri/state/expiresIn=180)                          | ✅     |
| 3   | Loopback case: no host passed → binds `127.0.0.1`                                                   | ✅     |
| 4   | Cross-machine case: host passed → binds `0.0.0.0`, callback address uses that host                  | ✅     |
| 5   | Repeated start → the old listener releases the port immediately                                     | ✅     |
| 6   | Unrelated request (favicon) gets 404 and the listener keeps going                                   | ✅     |
| 7   | Reachable across machines (an external host reaches the callback port)                              | ✅     |
| 8   | Callback with the correct state → 200 + success page                                                | ✅     |
| 9   | Callback without state → still allowed through (the key tolerance when Qobuz does not return state) | ✅     |
| 10  | Wrong state → 400 rejected                                                                          | ✅     |
| 11  | `error=access_denied` → fails immediately (measured 0 seconds, no idling for 180s)                  | ✅     |
| 12  | Port released after the callback (`ss -ltn` shows no residue)                                       | ✅     |
| 13  | Fake code exchange → the request correctly reaches Qobuz and returns 404                            | ✅     |
| 14  | Session projection `userId=2961963` (the real user id, not app_id)                                  | ✅     |

**Human end-to-end verification (completed on 2026-09-23 ✅)**

The device itself has no graphical browser and the browser is on the user's PC, so this step was done
by a human in the browser:

| Check                                                                                                              | Result                                               |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Clicked the authorization link → the browser completed the Qobuz login → redirect back to the device callback port | ✅ the callback page showed "Qobuz login successful" |
| No Console / F12 / copy-paste needed at any point                                                                  | ✅                                                   |
| The real exchange succeeded and returned `user_auth_token`                                                         | ✅                                                   |
| Session projection `userId=2961963`, `username=tomosak` (the real user id, not app_id)                             | ✅                                                   |
| Feature works: `catalog_search` returns results (measured: 3 Miles Davis albums)                                   | ✅                                                   |
| Callback port released after the login (`ss -ltn` shows no residue)                                                | ✅                                                   |

**Measured and confirmed exchange response shape** (the only item not measured before):

```json
{
  "status": "success",
  "user_id": "2961963",
  "display_name": "tomosak",
  "user_auth_token": "mDkSe-...",
  "user": { "id": "2961963", "login": "tomosak" },
  "is_active": false,
  "max_format_id": 5
}
```

That is, `oauth/callback` does return `user_auth_token` and `user_id`, and the multi-key tolerant
parsing in the implementation picked up the correct values, so no change is needed. The account is
non-subscription (`is_active=false`, `max_format_id=5`).

---

## 7. Known constraints

- In the cross-machine case the callback listener binds `0.0.0.0` (otherwise the browser on the user's
  PC cannot redirect back to the device).
  The risk is bounded by these factors: the port is random, it lives only during login, it lasts at
  most 180 seconds, it is one-shot, and the authorization code can only be issued by Qobuz.
  If the network segment is untrusted, prefer an SSH tunnel over long-term exposure.
- `state` validation follows "reject only when present and mismatched, allow when absent". The human
  end-to-end login was completed successfully on 2026-09-23 (see §6), so the old statement that it
  "has not yet been confirmed by a real login" no longer holds; but this record did not distinguish
  whether that real callback carried `state`, so the policy cannot be tightened on that basis, and
  "allow when absent" is kept for now, to be re-examined once `state` return can be observed during a
  real login.
