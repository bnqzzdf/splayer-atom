#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
UNIT_SOURCE="$ROOT_DIR/service/splayer-atom-core.service"
UNIT_TARGET="/etc/systemd/system/splayer-atom-core.service"
MODE=""
SERVICE_USER=""

usage() {
  echo "Usage: $0 --diretta | --user <service-user>" >&2
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
  echo "SPlayer Atom Core: systemd installation must run as root" >&2
  exit 1
fi

if [ "$MODE" = user ] && ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "SPlayer Atom Core: service user does not exist: $SERVICE_USER" >&2
  exit 1
fi

escape_sed() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

ROOT_ESCAPED=$(escape_sed "$ROOT_DIR")
if [ "$MODE" = user ]; then
  USER_LINE="User=$(escape_sed "$SERVICE_USER")"
else
  USER_LINE=""
fi

TMP_UNIT=$(mktemp)
trap 'rm -f "$TMP_UNIT"' EXIT HUP INT TERM
sed \
  -e "s|WorkingDirectory=/opt/splayer-atom-core|WorkingDirectory=$ROOT_ESCAPED|" \
  -e "s|ExecStart=/opt/splayer-atom-core/bin/splayer-atom-core|ExecStart=$ROOT_ESCAPED/bin/splayer-atom-core|" \
  -e "s|# @ATOM_SERVICE_USER@|$USER_LINE|" \
  "$UNIT_SOURCE" > "$TMP_UNIT"

install -m 0644 "$TMP_UNIT" "$UNIT_TARGET"
systemctl daemon-reload

echo "Installed $UNIT_TARGET"
if [ "$MODE" = diretta ]; then
  echo "Mode: Diretta/root"
else
  echo "Mode: ALSA user $SERVICE_USER"
fi
echo "Review the unit, then run: systemctl enable --now splayer-atom-core"
