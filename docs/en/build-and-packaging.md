# SPlayer Atom Build and Packaging

> Last updated: 2026-10-03

The only formal product is **Linux x86-64 Node Core + Web Control**.

## Build targets

| Target      | Command             | Output                                               |
| ----------- | ------------------- | ---------------------------------------------------- |
| Native      | `pnpm build:native` | `out/native/audio-engine.node`, `streaming-api.node` |
| Node Core   | `pnpm build:core`   | `out/core/`                                          |
| Web Control | `pnpm build:web`    | `out/renderer/`                                      |
| Full build  | `pnpm build`        | all of the above                                     |

## Environment

- Linux x86-64
- **Runtime requirement**: Core validates the actual Node runtime at startup and needs at least `>=22.19.0` (`core/atom/runtime/nodeRuntime.ts:2,35-39`); bundled-runtime carries its own reference Node
- **Build requirement**: packaging any Core flavor requires the current process Node to be **exactly `24.18.0`**, for `system` and `bundled` alike (`scripts/atom/build-core-system.ts:34`, `scripts/atom/stage-core-system.ts:88`, `core/atom/runtime/nodeRuntime.ts:1`)
- pnpm `>=10`
- Rust stable
- ALSA headers, Clang, pkg-config
- `libarchive-tools`: needed only by the CI dependency install line (`.github/workflows/dev.yml:54`); no repository script uses it (packaging and extraction both use GNU `tar`), so local builds can omit it

## Full build

```bash
pnpm build
```

The order is: native → Node/Web typecheck → Core bundle → Web bundle.

## Core package

System runtime:

```bash
pnpm package:core
```

Bundled runtime:

```bash
pnpm package:core:bundled
```

Artifacts:

```text
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz
```

The version comes from `package.json` and the date and time are the packaging date/time in `YYYYMMDD-HHMMSS` format.
Set `ATOM_BUILD_DATE=YYYYMMDD` when a reproducible build **content** is required; set `ATOM_BUILD_TIME=HHMMSS`
as well when the artifact **name** must also be reproducible. `runtime.json` only records the human-readable
`buildDate` (date), so fixing `ATOM_BUILD_DATE` alone already reproduces byte-identical content.

`<commit>` is the 8-character short commit (from `git rev-parse HEAD`, or the `commit=` field of the
`SOURCE_COMMIT` file shipped inside a source package). It always matches `runtime.json.atomCommit`
and the commit shown on the Web Control's About page — **a tarball alone tells you which commit it
was built from**, with no need to unpack and read `runtime.json`.

### The commit must exist and be published

The commit in the artifact name and in `runtime.json` is the only evidence of which source a build
came from, so it must be **real**: not merely SHA-shaped, but an actual commit object in the
repository and reachable from a **network remote** (`origin` and friends on `http(s)`/`ssh`). A
local-path or `file://` reference repository never counts — such a commit exists only on the build
host.

Staging fails otherwise instead of producing a tarball with an untraceable commit. A source package
without `.git` must prove the commit itself:

```text
commit=<sha>
dirty=false
date=<iso>
remote=https://github.com/bnqzzdf/splayer-atom.git
published=true
```

`published=true` is honored only together with a network `remote`; with a local-path `remote` the
identity is treated as unpublished.

For local experiments that explicitly do not need a release identity:

```bash
pnpm exec tsx scripts/atom/build-core-system.ts --bundle-node --allow-unpublished
```

It **only skips the check**; it never turns the identity into a published one, and such an artifact
must not be delivered as a release.

The staging contents include the Core JS, Web Control, both in-house native addons, runtime
dependencies such as `better-sqlite3`, `runtime.json`, LICENSE, the launcher and the deployment guide,
plus **two parallel service definitions**: the systemd unit with `install-systemd.sh`, and the OpenRC
script with `install-openrc.sh` (for targets without systemd such as GentooPlayer; see
[GentooPlayer (OpenRC) Service Management](./gentooplayer-openrc.md)).

Both flavors contain the same Core JS, Web Control, project-built addons, runtime dependencies
(including `better-sqlite3`), protocol, and data schema.

## Source packages

```bash
pnpm package:source
```

Exports the current **published commit** into
`out/splayer-atom-dev-<version>-<shortCommit>-src-<YYYYMMDD>-<HHMMSS>.tar.gz` plus a `.sha256`
sidecar. The content comes from the commit itself rather than the worktree, so the `SOURCE_COMMIT`
inside the package corresponds exactly to it, and the file is rendered by the same function in
`scripts/atom/sourceIdentity.ts` that the build side parses.

The commit must be published and the worktree clean: the entire value of a source package is
"fetching the same source by commit from the package", so one that cannot prove itself must not be
produced.

A clean-room build from such a package must first fetch that commit from the network remote declared
in `SOURCE_COMMIT` and verify the unpacked tree matches it before building; the build side re-checks
publication independently.

## Release tags

A tag states _which release_, and the commit is what the tag points at:

```bash
pnpm release:tag            # create the local tag and print the push command
pnpm release:tag --push     # create and push it
pnpm release:tag --dry-run  # check only
```

The tag name is `v<version>` from `package.json`. **Never put the build identity in a tag name**:
historical tags looked like `1.1.1-5ae8d992-20260925-091129`, where the commit came from a
build-host-only branch while the tag actually pointed at a different `dev` commit — the name and the
target disagreed, so resolving release code by tag name gives a wrong answer.

Tagging enforces a published identity, a clean worktree, and the absence of `v<version>` locally and
on the remote, so a tag always points at a commit that is findable in the shared repository.

## Release identity

`runtime.json` records only Atom's own identity and the runtime contract. The field list follows
`scripts/atom/stage-core-system.ts:227-262`:

- `productName`
- `atomVersion`
- `buildDate`
- `atomCommit`
- `sourceDirty`
- platform / arch
- Node range/reference/bundled state (`nodeRange` / `nodeReference` / `nodeBundled`)
- `betterSqlite3`: the `better-sqlite3` version actually staged into the artifact
- Core protocol version
- data schema versions
- `capabilities` (including the `diretta` capability bit)
- `diretta`: whether this artifact carries Diretta
- `direttaSdkRelease`: **always present**; `null` for builds without Diretta (the pinned SDK release otherwise)
- `direttaCpuVariant`: `v2` / `v3` / `v4` / `zen4`; `null` without Diretta

Formal releases should have `sourceDirty=false`.

## Diretta

A normal build does not require the proprietary SDK. A formal Diretta artifact must provide the supported SDK and request the required gate:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v2
```

The SDK release must match the version pinned by the repository; a missing or mismatched SDK fails
before staging (`scripts/atom/build-core-native.ts:51-56`). The SDK itself is not bundled.

## Debian 11 bundled package

For a glibc-compatible bundled artifact, use the pinned Debian 11 builder. It builds inside a
container on glibc 2.31, and the default has no Diretta:

```bash
pnpm package:core:debian11 --without-diretta
```

To include Diretta, provide the path to SDK 150 and select the target CPU variant:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

`v2`, `v3`, `v4`, and `zen4` select the SDK's x86-64 library variant — the variant decides whether
the artifact **can run on the target CPU at all**, not merely how fast it is; see
[CPU variants](./cpu-variants.md). The SDK is mounted read-only at build time and its files are never
placed into the artifact. The script checks the glibc version of the native addons, the Diretta
capability bit, and startup of the artifact. The two modes are retained separately as
`out/*-debian11-without-diretta.tar.gz` and `out/*-debian11-with-diretta-<variant>.tar.gz`.
SDK 150's ACQUA library uses an old-glibc compatibility shim for integer parsing.

The builder keeps `node_modules` and the pnpm store in Docker volumes, rebuilds `better-sqlite3`
inside Debian 11, and rejects native artifacts requiring newer than glibc 2.31. It uses the Tsinghua
Debian main/updates mirrors and a fixed Debian security snapshot for explicit package installation
only. It does not install or enable unattended security updates.

The container itself (Dockerfile + in-container build script + cache volume notes) lives in
[`docker/atom-debian11/`](https://github.com/bnqzzdf/splayer-atom/blob/dev/docker/atom-debian11/README.md).

## Artifact smoke

`scripts/atom/build-core-system.ts` runs staging and the final artifact checks in the formal build
chain. The checks include:

- runtime metadata
- native addon load
- plugin-host IPC
- Core `/api/info`, session, library, cache
- the Web root page
- startup / SIGTERM
- whether bundled-runtime really uses the Node inside the package

## CI

`.github/workflows/dev.yml` builds Core/Web on `ubuntu-24.04` Linux x86-64 with Node `24.18.0`
and Rust stable. The workflow runs `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`pnpm package:core` in order, then uploads
`out/splayer-atom-core-*-system-linux-x64.tar.gz` with `actions/upload-artifact`
(`.github/workflows/dev.yml:62-78`). The Debian 11 container is a separate packaging environment.
Record the actual build environment, source commit, and artifact hash for a release.

## Release gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm package:core
pnpm release:tag --dry-run
pnpm docs:build
pnpm docs:stamp:check
cargo check --workspace
cargo test --workspace
git diff --check
```

See [Core Deployment](./core-deployment.md) and the [Hardware Release Checklist](./hardware-release-checklist.md).
