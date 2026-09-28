# SPlayer Atom Build and Packaging

> Last updated: 2026-09-28

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
- Node `>=22.19.0`; formal build and bundled-runtime reference `24.18.0`
- pnpm `>=10`
- Rust stable
- ALSA headers, Clang, pkg-config, libarchive-tools

## Packaging

System runtime:

```bash
pnpm package:core
```

Bundled runtime:

```bash
pnpm package:core:bundled
```

For a glibc-compatible bundled artifact, use the pinned Debian 11 builder. It keeps
`node_modules` and the pnpm store in Docker volumes, rebuilds `better-sqlite3` inside Debian 11,
and rejects native artifacts requiring newer than glibc 2.31. The default has no Diretta:

```bash
pnpm package:core:debian11 --without-diretta
```

To include Diretta, supply SDK 150 and select an x86-64 library variant (`v2`, `v3`, or `v4`):

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

The SDK is mounted read-only and is not packaged. The builder checks native glibc requirements,
Diretta capability metadata, and startup of the extracted artifact. It retains separate
`*-debian11-without-diretta.tar.gz` and `*-debian11-with-diretta-<variant>.tar.gz` copies.
SDK 150's ACQUA library uses an old-glibc compatibility shim for integer parsing.

The builder uses the Tsinghua Debian main/updates mirrors and a fixed Debian security snapshot for
explicit package installation only. It does not install or enable unattended security updates.

Artifacts:

```text
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz
out/splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz
```

The version comes from `package.json` and the date and time are the packaging date/time in `YYYYMMDD-HHMMSS` format.
Set `ATOM_BUILD_DATE=YYYYMMDD` when a reproducible date is required. `runtime.json` also records a
human-readable `buildDate`.

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

`runtime.json` records the Atom version, build date, commit/dirty state, platform/arch, Node
contract, protocol/schema versions, capabilities, and the Diretta SDK release when applicable.
Formal releases should have `sourceDirty=false`.

## Diretta

A normal build does not require the proprietary SDK. A formal Diretta artifact must provide the supported SDK and request the required gate:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v2
```

The SDK itself is not bundled.

## CI and gates

`.github/workflows/dev.yml` builds Core/Web on `ubuntu-24.04` Linux x86-64 with Node `24.18.0`
and Rust stable. The Debian 11 container is a separate packaging environment. Record the actual
build environment, source commit, and artifact hash for a release.

Recommended release gates:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm package:core
pnpm release:tag --dry-run
pnpm docs:build
cargo check --workspace
cargo test --workspace
git diff --check
```

See [Core Deployment](./core-deployment.md) and the [Hardware Release Checklist](../hardware-release-checklist.md).
