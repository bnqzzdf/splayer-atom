#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INIT_SOURCE="$ROOT_DIR/service/splayer-atom-core.openrc"
INIT_TARGET="/etc/init.d/splayer-atom-core"
CONF_TARGET="/etc/conf.d/splayer-atom-core"
# 这一行由本脚本维护：重装时先删掉它自己（连同它管的两个赋值），再重写一遍，
# 避免多次安装把注释叠成好几层。
CONF_HEADER="# 由 service/install-openrc.sh 生成：安装根与运行用户由它维护，其余内容可自行追加。"
MODE=""
SERVICE_USER=""

usage() {
  echo "Usage: $0 --diretta | --user <service-user>" >&2
  echo "  OpenRC targets (GentooPlayer); systemd targets use install-systemd.sh" >&2
}

case "${1:-}" in
  --diretta)
    MODE=diretta
    [ "$#" -eq 1 ] || { usage; exit 2; }
    ;;
  --user)
    [ "$#" -eq 2 ] || { usage; exit 2; }
    MODE=user
    SERVICE_USER=$2
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "SPlayer Atom Core: OpenRC installation must run as root" >&2
  exit 1
fi

if [ "$MODE" = user ] && ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "SPlayer Atom Core: service user does not exist: $SERVICE_USER" >&2
  exit 1
fi

# OpenRC 目标机的判据：openrc-run 与 rc-update 都要在。systemd 目标机请用 install-systemd.sh。
if [ ! -x /sbin/openrc-run ] || ! command -v rc-update >/dev/null 2>&1; then
  echo "SPlayer Atom Core: this host does not look like an OpenRC system (需要 /sbin/openrc-run 与 rc-update)" >&2
  echo "SPlayer Atom Core: use service/install-systemd.sh on systemd hosts" >&2
  exit 1
fi

if [ ! -f "$INIT_SOURCE" ]; then
  echo "SPlayer Atom Core: missing service script: $INIT_SOURCE" >&2
  exit 1
fi

if [ ! -x "$ROOT_DIR/bin/splayer-atom-core" ]; then
  echo "SPlayer Atom Core: launcher not found: $ROOT_DIR/bin/splayer-atom-core" >&2
  echo "SPlayer Atom Core: run this script from the extracted installation root" >&2
  exit 1
fi

# init.d 脚本本身不含机器相关路径（安装根来自 conf.d），因此按原样安装、可校验 md5。
install -m 0755 "$INIT_SOURCE" "$INIT_TARGET"

# conf.d 由本脚本生成：只管理 SPLAYER_ATOM_ROOT 与 command_user 两行，
# 其余行（用户自己加的 export / 覆盖项）原样保留。
TMP_CONF=$(mktemp)
trap 'rm -f "$TMP_CONF"' EXIT HUP INT TERM
{
  echo "$CONF_HEADER"
  echo "SPLAYER_ATOM_ROOT=\"$ROOT_DIR\""
  if [ "$MODE" = user ]; then
    echo "command_user=\"$SERVICE_USER\""
  fi
  if [ -f "$CONF_TARGET" ]; then
    grep -v -E '^[[:space:]]*(SPLAYER_ATOM_ROOT|command_user)=' "$CONF_TARGET" \
      | grep -v -F "$CONF_HEADER" \
      | grep -v -E '^[[:space:]]*$' || true
  fi
} > "$TMP_CONF"
install -m 0644 "$TMP_CONF" "$CONF_TARGET"

echo "Installed $INIT_TARGET"
echo "Wrote $CONF_TARGET (SPLAYER_ATOM_ROOT=$ROOT_DIR)"
if [ "$MODE" = diretta ]; then
  echo "Mode: Diretta/root"
else
  echo "Mode: ALSA user $SERVICE_USER"
fi
echo "Review the service script, then run:"
echo "  rc-update add splayer-atom-core default"
echo "  rc-service splayer-atom-core start"
