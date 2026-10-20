# GentooPlayer (OpenRC) Service Management

> Last updated: 2026-10-03

GentooPlayer (GP) is one of the primary deployment targets for Core, and it is a **pure OpenRC**
system: there is no systemd, so `service/install-systemd.sh` and the systemd-based steps in this
documentation site do not apply on GP. This page covers development, deployment, upgrade and
day-to-day service management on GP. Everything here is backed by measurements on a real machine
(baseline: GentooPlayerX86 v373 x86-64, OpenRC `0.63.3`, `splayer-atom-core` 1.1.3).

The parts that are identical to systemd (artifact layout, `data/` as the authoritative persistent
state, the directory-level rollback rule) live in
[Core Deployment and Upgrade](./core-deployment.md); this page only covers the differences and the
OpenRC side.

## Target machine shape (measured baseline)

| Item                | Measured value                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Init system         | OpenRC `0.63.3 (Gentoo Linux)`; `/sbin/{openrc,openrc-run,rc-service,rc-update,supervise-daemon}`                                 |
| systemd             | **Absent**: no `systemctl`, no `/run/systemd` ⇒ the systemd unit and installer shipped inside the artifact cannot be used         |
| Service scripts     | 175 under `/etc/init.d/`; 172 use `#!/sbin/openrc-run`, 17 use `supervise-daemon`                                                 |
| Parameter overrides | 67 files under `/etc/conf.d/`                                                                                                     |
| Runlevels           | `sysinit` / `boot` / `default` / `shutdown`; every `/etc/runlevels/<level>/<service>` is a **symlink** to `/etc/init.d/<service>` |
| Panel integration   | Menu item "05. Enable/disable software", Web panel `:8889` (`service_manager.py`), and the "0. Software pages" cards              |

The runlevels contain a set of GP-specific **one-shot services**: `trim`, `clockup`, `gpkernel1`,
`gphavagedstop`, `gp_starter`, `gpchronystop`, `gpsetrestart`, `gprtclock`. They do their work at
boot and then call `rc-service $RC_SVCNAME stop` themselves, so showing `[stopped]` in
`rc-status default` is **expected** and does not mean they never ran. To tell whether a service is
meant to stay resident, check whether it is a `supervise-daemon` or self-managed supervisor type.

## OpenRC vs systemd

| Concept                | systemd                                    | OpenRC (GP)                                                                          |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Service definition     | `/etc/systemd/system/<x>.service`          | `/etc/init.d/<x>` (`#!/sbin/openrc-run`)                                             |
| Parameter override     | `Environment=` inside the unit             | `/etc/conf.d/<x>` (sourced before start, can override script variables)              |
| Enable at boot         | `systemctl enable <x>`                     | `rc-update add <x> default` (creates a symlink in `/etc/runlevels/default/`)         |
| Start/stop/restart     | `systemctl start/stop/restart <x>`         | `rc-service <x> start/stop/restart`                                                  |
| Status                 | `systemctl status <x>`                     | `rc-service <x> status` (exit code **0=started, 3=stopped**)                         |
| Enabled check          | `systemctl is-enabled <x>`                 | `rc-update show -v \| grep <x>`, or inspect `/etc/runlevels/*/<x>`                   |
| Ordering               | `After=` / `Wants=`                        | `depend() { need / use / after / before / want }`                                    |
| Supervisor and restart | `Restart=on-failure` + `RestartSec=`       | `supervisor="supervise-daemon"` + `respawn_delay` / `respawn_max` / `respawn_period` |
| Run user               | `User=` / `Group=`                         | `command_user=` / supervisor user argument (root by default on GP)                   |
| Resource limits        | `LimitMEMLOCK=infinity` / `LimitRTPRIO=95` | `ulimit -l unlimited` / `ulimit -r 95` inside `start_pre()`                          |
| Logs                   | `journalctl -u <x>`                        | `output_log` / `error_log` (conventionally `/var/log/<x>.log`, `<x>.err.log`)        |
| All service states     | `systemctl list-units`                     | `rc-status --servicelist --nocolor`                                                  |
| State reset            | `systemctl reset-failed <x>`               | `rc-service <x> zap` (manually resets to stopped)                                    |

## Development: writing a service script that works on GP

### Recommended skeleton

The `service/splayer-atom-core.openrc` shipped in the artifact is exactly this skeleton
(`install-openrc.sh` installs it verbatim, with no sed rewriting), so this section doubles as
"how to read the shipped script" and "how to write your own GP service":

```sh
#!/sbin/openrc-run
name="splayer-atom-core"
description="SPlayer Atom Core"

command="/opt/splayer-atom-core/bin/splayer-atom-core"
directory="/opt/splayer-atom-core"
supervisor="supervise-daemon"
pidfile="/run/${RC_SVCNAME}.pid"
output_log="/var/log/${RC_SVCNAME}.log"
error_log="/var/log/${RC_SVCNAME}.err.log"

# Bounded restart: respawn_period must be >= respawn_delay × respawn_max,
# otherwise supervise-daemon errors out and degrades to an unlimited restart loop.
respawn_delay=5
respawn_period=120
respawn_max=10

# Stop sequence: SIGTERM first, SIGKILL after the timeout
retry="TERM/5/KILL/5"

depend() {
    need net
    after localmount
}

start_pre() {
    # Diretta Host / ALSA need locked-memory realtime privileges; equivalent to systemd's LimitMEMLOCK=infinity
    ulimit -l unlimited 2>/dev/null || true
    # ALSA output writer threads switch to SCHED_FIFO; equivalent to systemd's LimitRTPRIO=95
    ulimit -r 95 2>/dev/null || true
}
```

### Rules (each one maps to a real incident)

1. **The shebang must be `#!/sbin/openrc-run`.** With `/bin/sh`, `rc-service` fails on
   `ebegin`/`eend`/`start_pre` and friends.
2. `command=` must be an **absolute path**; `directory=` is the working directory (systemd's
   ⚠️ More importantly, this line must be a **literal path**, never `${SPLAYER_ATOM_ROOT}/bin/…`:
   GentooPlayer's menu probe (`gp_menus_probe` in `script/enable/values.sh`) `sed`s the **raw text**
   of the `command=` line and runs `[ -f ]` on it — it does **not** expand variables, so a service whose
   `command=` is built from a variable is reported as `NOT INSTALLED` and its menu switch disappears
   (this project's shipped script hit exactly that regression; it now uses a literal path and a gate
   assertion guards it). For a non-standard install root, `install-openrc.sh` rewrites that literal.
   `WorkingDirectory=`). The Core launcher must run from the installation root, otherwise it cannot
   derive `runtime/bin/node` and `app/`.
3. `supervisor="supervise-daemon"` is OpenRC's built-in supervisor and restarter; 17 services on GP
   use it (including `splayer-atom-core`, `splayer-headless`, `splayer-android-web`). Without a
   supervisor you can also use `command_bg=yes` plus
   `start_stop_daemon_args="--background --make-pidfile …"` to manage a process that already
   daemonizes itself (that is how GP's `rdsa` does it).
4. **Always bound the restart.** `respawn_max=0` means unlimited restarts: a binary that cannot run
   turns into a silent crash loop while `rc-service <x> status` **still reports started** (what is
   supervised is the wrapper process). We hit this twice on GP: the AVX2 build of `rdsa` raised
   `SIGILL` (exit code 132) on a Celeron J1900 without AVX, and the only trace was
   `[supervisor] rdsa exited code=132 after 0s, restarting in …` in the log while the service state
   said started. A bounded restart (5s / 120s / 10 tries as above) surfaces the problem immediately.
   **Measured**: pointing `SPLAYER_ATOM_ROOT` at a fake launcher that exits 132 made
   `supervise-daemon` give up on the **11th** crash and `rc-service status` flip from `started` to
   `stopped` (rc=3); with an unbounded setting the same scenario only ever reported started while
   the log grew silently.
5. `respawn_period >= respawn_delay × respawn_max` is an observed constraint: when it is not met,
   `supervise-daemon` prints `Please decrease the value of --respawn-period …` and degrades to
   unlimited restarts (`respawn_max` defaults to 10 and `respawn_period` to 12s per
   `man 8 supervise-daemon`; the constraint itself comes from real runs and the original comment is
   preserved in `_materials/integration/openrc-headless/etc-init.d-splayer-headless`).
6. Keep `pidfile` under `/run` (tmpfs), never inside the installation directory; put
   `output_log`/`error_log` under `/var/log`. The installation directory must not accumulate
   production log files (same contract as Core's logging rule).
7. **Put every overridable parameter in `/etc/conf.d/<service>`** instead of hardcoding environment
   variables in the script. OpenRC sources `/etc/conf.d/<x>` **first** and only then executes the
   init.d script body (measured on the baseline machine with a probe: the script body already sees
   the conf.d value), so every tunable in the script must use `: "${VAR:=default}"`. A plain
   `VAR=default` assignment overrides conf.d and the user's change silently does nothing. To pass
   environment variables to Core (for example `ATOM_SERVER_PORT`), `export` them in conf.d.
8. Use `start_pre()` / `stop_post()` for pre-flight checks and cleanup. Example: `rdsa`'s
   `start_pre()` runs `ulimit -l unlimited` and then generates or validates the machine-local RAAT
   identity file. Note that such a pre-flight step **must not block startup** — an optional
   calibration step should never prevent the service from coming up.
9. For "run once and exit" orchestration services, the GP idiom is a custom `start()`: `ebegin` →
   background subshell does the work → `rc-service "$RC_SVCNAME" stop` → `eend` (see
   `/etc/init.d/trim` and `/etc/init.d/gp_starter`).
10. Express ordering through `depend()`: `need net` (hard dependency on the network),
    `after localmount` (wait for local mounts), `after *` (GP's trailing services use it to sort
    last). The keywords mean `need` (hard dependency; if it fails, this service does not start),
    `use` (soft dependency), `after`/`before` (ordering only) and `want`.
11. Run user: Diretta Host and ALSA realtime output require root, and GP services run as root by
    default. To run as non-root you must set `command_user=` explicitly and grant audio device
    access plus `rtprio`/`memlock` (via `@audio`/`@realtime` in `/etc/security/limits.conf`); do not
    do this on a Diretta target.
12. **Never call `systemctl` on GP.** A script containing `systemctl restart …` only produces
    `command not found` on GP, and `rc-service <x> status` still reports started — one of the
    hardest failure modes to diagnose.

### Pre-deployment self-checks

```sh
# Syntax check (an OpenRC script is POSIX shell, so sh -n works)
sh -n /etc/init.d/splayer-atom-core

# Dry run: print the start/stop flow without touching the service
rc-service -Z splayer-atom-core start

# Existence (without starting): rc=0 means OpenRC can parse the script
rc-service -e splayer-atom-core
```

## Deployment: first install on GP

The artifact, the installation layout and the meaning of `data/` are identical to the systemd
deployment (see [Core Deployment and Upgrade](./core-deployment.md)); only service registration
differs.

1. Unpack the artifact into the installation root (the archive top level _is_ the installation
   root; there is no outer directory):

```sh
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-<version>-<commit>-bundled-linux-x64.tar.gz -C /opt/splayer-atom-core
```

2. Verify the launcher before installing the service:

```sh
cd /opt/splayer-atom-core
./bin/splayer-atom-core        # should log startup and listen on 14558; Ctrl-C to exit
```

3. Install the OpenRC service script. The artifact ships this pair (**do not use
   `service/install-systemd.sh`** — GP has no systemctl):

```sh
sudo ./service/install-openrc.sh --user splayer-atom   # plain ALSA Core
# or: sudo ./service/install-openrc.sh --diretta        # Diretta Host / root
```

What the installer does: it installs `service/splayer-atom-core.openrc` as
`/etc/init.d/splayer-atom-core` (0755) — **verbatim** when the install root is the default
`/opt/splayer-atom-core` (so it can be checked against the artifact by md5), and with that literal
path rewritten when the root differs; it then writes `/etc/conf.d/splayer-atom-core`
(`SPLAYER_ATOM_ROOT` only for a non-default root, plus `command_user` in `--user` mode) and keeps any
lines you added to conf.d yourself when reinstalling. It does not start or enable the service (same
contract as `install-systemd.sh`), and on a systemd host it refuses and points at
`install-systemd.sh`.

After installing it also **runs GentooPlayer's own probe** (`script/enable/values.sh <service>`) and
prints the result; if the probe reports `NOT INSTALLED` it prints an extra `WARNING`. That is exactly
what catches the silent integration failure where the service runs but the menu has no switch (see
the literal `command=` constraint in the development section).

4. Enable at boot and start it now:

```sh
sudo rc-update add splayer-atom-core default
sudo rc-service splayer-atom-core start
rc-service splayer-atom-core status   # exit 0 = started; 3 = stopped
```

> If the previous-generation `splayer-headless` is also enabled on the same machine it uses the same
> default port as Core (**14558**): stop it first, or `export ATOM_SERVER_PORT=<port>` in
> `/etc/conf.d/splayer-atom-core`, otherwise Core fails at startup with `EADDRINUSE` (the bounded
> restart gives up after about 11 crashes and the state drops to stopped).

5. Verify the runtime surface:

```sh
rc-update show -v | grep splayer-atom-core     # boot registration
rc-status default                              # all services in that runlevel
curl -s http://127.0.0.1:14558/api/info        # atomVersion / atomCommit / sourceDirty
tail -n 50 /var/log/splayer-atom-core.log
```

### Registering with GP's two management surfaces

GP users normally do not type `rc-*` commands; they use the menu and the panel. To make a service
appear in both, one file per surface has to change:

| Surface                            | Location                                                                                                    | What to change                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Menu "05. Enable/disable software" | `/opt/.gentooplayer/web/conf/runners/menu_enable_player.json` + `/opt/.gentooplayer/web/scripts/enablep.sh` | Add the menu parameter `-splayer-atom-core`; add one line to the service table in `enablep.sh` |
| "0. Software pages" cards          | `/opt/.gentooplayer/web/scripts/websoftware.sh`                                                             | Add a card row `SPlayer Atom Core\|…\|:14558\|splayer-atom-core\|\|openrc`                     |
| Web panel `:8889`                  | `/srv/py/service_manager.py`                                                                                | `TARGET_SERVICES` (managed services), `SERVICE_DISPLAY_NAMES`, `SERVICE_CATEGORY`              |

The menu decision chain (three scripts, each owning one part):

```text
menu_enable_player.json          menu definition: -<service> + values/script + default/script
  → script/enable/values.sh <x>  dropdown values: enable/disable when the service exists, else NOT INSTALLED
  → script/enable/default.sh <x> current value: whether rc-update show -v lists a default row for it
  → enablep.sh -<x> enable|disable
        enable : rc-update add <x> default && rc-service <x> restart
        disable: rc-update del <x> default && rc-service <x> stop
                 (if /opt/.gentooplayer/web/scripts/script/enable/stop_hooks.sh exists, it runs it afterwards)
```

Two consequences worth memorizing:

- **`disable` only removes the `default` runlevel registration and stops the service**; it does not
  delete `/etc/init.d/<x>`. "I turned it off in the menu but it is still running" usually means
  something else (a manual `rc-service start`, another runlevel) brought it back up.
- **`enable` uses `rc-service restart`**, which is equivalent to `start` for a stopped service.

The repository already ships this integration layer, so the panel files do not need hand editing:

```sh
ls _materials/integration/gp-menu/     # gp-menus.json, apply-gp-menus.py, deploy-gp-menus.sh
```

On GP, a "0. Software pages" card looks at both "is the port listening" and "is OpenRC started";
the trailing `openrc` flag in a card row means **only the OpenRC state counts** and no port
fallback is applied — this was the fix for multiple cards on the same port lighting up together.

## Upgrade and rollback

The flow is the same directory-level upgrade as
[Core Deployment and Upgrade](./core-deployment.md); the only difference is replacing `systemctl`
with `rc-service`. The principle is unchanged: **keep the complete previous installation** so a
rollback never depends on an old Core reading `data/` already migrated by a new Core.

```sh
# 1) Stop and confirm (3 = stopped)
sudo rc-service splayer-atom-core stop
rc-service splayer-atom-core status

# 2) Rename the old installation, keeping its pre-upgrade data/
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.rollback

# 3) Unpack the new artifact into the original path
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf <new-artifact>.tar.gz -C /opt/splayer-atom-core

# 4) Restore a copy of the pre-upgrade persistent state (copy, do not move)
sudo rm -rf /opt/splayer-atom-core/data
sudo cp -a /opt/splayer-atom-core.rollback/data /opt/splayer-atom-core/data

# 5) Reinstall init.d only when the service definition itself changed, then start
sudo install -m 0755 ./splayer-atom-core.openrc /etc/init.d/splayer-atom-core
sudo rc-service splayer-atom-core start
```

Three differences from the systemd deployment:

- **The runlevel registration is not affected by an upgrade**: `/etc/runlevels/default/<x>` is a
  symlink to `/etc/init.d/<x>`, so as long as the service name stays the same no `rc-update add` is
  needed (reinstalling init.d does not touch the symlink either).
- **`rc-service stop` waits for `supervise-daemon` to reap the process**; after it returns, `status`
  should be 3. If it is still 0, check `/var/log/<x>.err.log` first, then reset the state cache with
  `rc-service <x> zap`.
- **In GP's ramdisk mode (`/usr` as tmpfs) changes under `/etc` do not persist.** The baseline
  machine here uses a regular root filesystem (no `on /usr type tmpfs` in `mount -l`), so
  `rc-update`/`install` results survive a reboot. When deploying on a ramdisk-mode machine, verify
  the change landed on the persistent layer, otherwise it reverts on reboot.

Rolling back means swapping the rollback directory in and starting again:

```sh
sudo rc-service splayer-atom-core stop
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
sudo rc-service splayer-atom-core start
rc-status default                                   # boot registration should still be there
curl -s http://127.0.0.1:14558/api/info             # version/commit should be back to the previous build
```

## Service management cheat sheet

```sh
rc-service <x> start|stop|restart|status|zap   # one service; status: 0=started, 3=stopped
rc-service -l                                  # list every available service
rc-service -e <x>                              # does that init.d exist (rc=0 means yes)
rc-service -Z <x> start                        # dry run, prints the steps it would take
rc-update add|del <x> default                  # register / unregister boot startup
rc-update show -v                              # service → runlevel overview (scripts use this for the enabled check)
rc-status default                              # state of one runlevel
rc-status --servicelist --nocolor              # every service state (this is what the panel uses)
rc-status --crashed                            # services that crashed
openrc default                                 # re-run the default runlevel
```

State is cached under `/run/openrc/` (`daemons`, `failed`, `inactive`, `options`, `scheduled`, …).
Do not edit it by hand; use `rc-service <x> zap` to reset a service from an abnormal state.

Logs and runtime surface:

| Content                    | Location                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Service stdout             | `/var/log/<x>.log` (`output_log`)                                                      |
| Service stderr             | `/var/log/<x>.err.log` (`error_log`)                                                   |
| GP panel operation history | `/opt/.gentooplayer/web/logs/`                                                         |
| OpenRC itself              | does **not** write `/var/log/rc.log` by default (`rc_logger` is off in `/etc/rc.conf`) |
| Core runtime surface       | `curl http://127.0.0.1:14558/api/info`, `/api/session`                                 |

## Troubleshooting checklist

| Symptom                                                               | Look at first                                            | Usual root cause                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` says started but the feature does not work                   | `/var/log/<x>.err.log`, whether the child process exists | unlimited restart hides a child crash (`respawn_max=0` plus SIGILL/missing library)                                                                                                                                                                                                    |
| `status` is 3, it will not start                                      | `/var/log/<x>.err.log`, `depend()`                       | unmet dependency (`need net` before the network is up), missing `command=` path                                                                                                                                                                                                        |
| Edited init.d but nothing changed                                     | `rc-service <x> zap`, then retry                         | the state cache still holds the old state                                                                                                                                                                                                                                              |
| No startup at boot                                                    | `rc-update show -v`, `/etc/runlevels/default/<x>`        | missing `rc-update add`, or a one-shot service stopped itself                                                                                                                                                                                                                          |
| Turned off in the menu but still running                              | `rc-status default`, `ps`                                | started by another runlevel or by hand; `disable` only covers the default runlevel                                                                                                                                                                                                     |
| Menu shows NOT INSTALLED                                              | `command=` in `/etc/init.d/<x>`                          | GP's probe checks whether the file `command=` points at exists (see `script/enable/values.sh`) (the probe does **not** expand variables); `command=` must be a **literal absolute path** — a `${VAR}/…` form or an interpreter wrapper (python/bash/node) is reported as not installed |
| `systemctl` not found inside a script                                 | —                                                        | GP has no systemd; service management must use `rc-*` (the skeleton above already does)                                                                                                                                                                                                |
| conf.d change has no effect                                           | is that line a plain `VAR=default` in the script         | a plain assignment overrides conf.d; use `: "${VAR:=default}"` (OpenRC sources conf.d first)                                                                                                                                                                                           |
| Startup fails with `EADDRINUSE: address already in use 0.0.0.0:14558` | `ss -ltnp \| grep 14558`                                 | The previous-generation `splayer-headless` also listens on **14558** by default (on one GP machine it was enabled at boot and held the port); stop it, or give Core another port with `export ATOM_SERVER_PORT=<port>` in `/etc/conf.d/splayer-atom-core`                              |
| `status` says started but the log shows repeated restarts             | `tail /var/log/splayer-atom-core.err.log`                | A startup-time error such as a port conflict or a missing library; the bounded restart gives up after about 11 crashes and drops the state to stopped, while an unbounded setting would only ever report started                                                                       |

## Related files

- systemd installation path inside the artifact: [Core Deployment and Upgrade](./core-deployment.md)
- OpenRC assets inside the artifact: `service/splayer-atom-core.openrc` (service script) and
  `service/install-openrc.sh` (installer); sources live in `scripts/atom/core-system/`
- OpenRC assets in this repository: `_materials/integration/openrc-headless/`
  (`etc-init.d-splayer-headless`, `etc-init.d-splayer-android-web`, `部署说明.md`)
- GP menu assets in this repository: `_materials/integration/gp-menu/`
- Build gates and artifact naming: [Build and Packaging](./build-and-packaging.md)
