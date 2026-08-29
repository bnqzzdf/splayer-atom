# SPlayer Atom Core Deployment and Upgrade

This document describes the supported Linux x86-64 system-runtime deployment model for the current Core artifact.

## Runtime contract

- Core requires Node `>=24.18.0 <25`.
- Release/reference validation uses Node `24.18.0`.
- The system-runtime and future bundled-runtime variants execute the same Core JS/native/protocol contract.
- The current production artifact is Linux x86-64 only. Hardware support still depends on the release acceptance matrix.

## Installation layout

The extracted `core-system` directory is the installation root:

```text
core-system/
├─ app/
├─ renderer/
├─ native/
├─ node_modules/
├─ bin/
├─ service/
├─ docs/
├─ data/
├─ runtime.json
└─ LICENSE
```

`data/` is durable state. It contains the SQLite database, settings and provider/session configuration and must not be discarded during an upgrade. Rebuildable caches stay outside the installation root and follow the Core XDG cache path.

## First installation

Extract the release into its final location, for example `/opt/splayer-atom-core`, then verify the launcher before installing a service:

```bash
cd /opt/splayer-atom-core
./bin/splayer-atom-core
```

The launcher uses `ATOM_NODE_BIN` when explicitly provided, then `runtime/bin/node` when a future bundled runtime is present, and otherwise the system `node` executable.

### systemd for ordinary ALSA Core

Create a dedicated service account according to the host's normal administration policy, then run the included helper as root:

```bash
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl enable --now splayer-atom-core
```

The helper installs a unit pointing to the actual extracted directory. It does not start or enable the service automatically.

The service account must have read/write access to the installation `data/` directory and the configured XDG cache directory, plus the host audio-device permissions required for ALSA.

### systemd for Diretta Core

Linux Diretta Host connection/playback validation requires the Host process to run as root. For a Core instance that will expose Diretta Source Direct, install the root-mode unit explicitly:

```bash
sudo ./service/install-systemd.sh --diretta
sudo systemctl enable --now splayer-atom-core
```

Do not infer a Target fault from a non-root Diretta connection timeout. Diretta hardware acceptance also requires the Target to be exclusively available when connection state is ambiguous.

## Upgrade procedure

Do not unpack a new release over the active installation. Preserve the complete previous installation so rollback never depends on an old Core reading data already migrated by a newer Core.

Assume the active installation is `/opt/splayer-atom-core` and the new archive extracts as `core-system`.

1. Stop Core and confirm the service is inactive.

```bash
sudo systemctl stop splayer-atom-core
sudo systemctl is-active splayer-atom-core
```

2. Rename the complete current installation to a rollback directory. Keep it intact, including its pre-upgrade `data/`.

```bash
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.rollback
```

3. Extract the new release into the original installation path.

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-system-linux-x64.tar.gz \
  -C /opt/splayer-atom-core --strip-components=1
```

4. Replace the new artifact's empty `data/` with a copy of the pre-upgrade durable state. Copy rather than move it so the rollback directory remains independently recoverable.

```bash
sudo rm -rf /opt/splayer-atom-core/data
sudo cp -a /opt/splayer-atom-core.rollback/data /opt/splayer-atom-core/data
```

5. Reinstall the systemd unit from the new artifact using the same mode as the previous installation, then start Core.

```bash
sudo ./service/install-systemd.sh --user splayer-atom
# or: sudo ./service/install-systemd.sh --diretta
sudo systemctl start splayer-atom-core
```

6. Verify `/api/info`, `/api/session`, the Web Control root and the expected library state before removing any rollback copy.

When the copied durable state uses an older known schema, Core performs migration before normal store/database initialization. A migration backup is created under `data/backups/migration-*` only when an existing database or config actually needs migration. SQLite backups use `VACUUM INTO`, and the durable config directory is copied into the same snapshot.

Core refuses a database or settings schema newer than the current build supports. Do not work around that refusal by deleting the database or settings file.

## Rollback procedure

If the new Core fails acceptance, do not run the previous binary against the new installation's possibly migrated `data/`.

1. Stop the failed Core.
2. Preserve the failed installation for diagnosis instead of deleting it.
3. Restore the complete pre-upgrade directory to the original path.
4. Reinstall its systemd unit if the service definition changed, then start it.

For example:

```bash
sudo systemctl stop splayer-atom-core
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
# or: sudo ./service/install-systemd.sh --diretta
sudo systemctl start splayer-atom-core
```

This directory-level rollback restores both the previous executable release and its pre-upgrade durable state. The newer installation and any migration backup remain available for diagnosis until the operator intentionally removes them.

## Backup and recovery rules

- Keep at least one complete pre-upgrade installation until the new release passes acceptance.
- Treat `data/` as authoritative durable state; do not replace it with cache contents.
- Migration snapshots supplement the complete pre-upgrade directory. They do not replace the requirement to retain the previous release for rollback.
- Never use "delete the database and rescan" as the production recovery procedure for a failed schema migration.
- Do not restore only `library.db` while keeping newer provider/settings files unless the recovery case has been explicitly verified. Prefer restoring the complete matching durable snapshot or complete previous installation.

## Service diagnostics

Useful checks after install, upgrade or rollback:

```bash
systemctl status splayer-atom-core
journalctl -u splayer-atom-core -n 200 --no-pager
node --version
cat /opt/splayer-atom-core/runtime.json
```

Core production logs go to stdout/stderr so systemd/journald remains the deployment log owner. The installation directory should not accumulate production log files.
