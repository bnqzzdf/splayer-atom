#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SERVICE_NAME="splayer-atom-core"
DEFAULT_ROOT="/opt/splayer-atom-core"
INIT_SOURCE="$ROOT_DIR/service/splayer-atom-core.openrc"
INIT_TARGET="/etc/init.d/$SERVICE_NAME"
CONF_TARGET="/etc/conf.d/$SERVICE_NAME"
# GentooPlayer 菜单「05. 启用/禁用软件」的存在性探针（存在才用它的输出复核）
GP_PROBE="/opt/.gentooplayer/web/scripts/script/enable/values.sh"
# 这一行由本脚本维护：重装时先删掉它自己（连同它管的赋值），再重写一遍，
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

escape_sed() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

TMP_INIT=$(mktemp)
TMP_CONF=$(mktemp)
trap 'rm -f "$TMP_INIT" "$TMP_CONF"' EXIT HUP INT TERM

# init.d 脚本：
#   · 默认安装根（/opt/splayer-atom-core）按原样安装，可与产物内文件校验 md5；
#   · 其它安装根必须把脚本里的**字面路径**一起改写 —— GP 菜单的存在性探针直接 sed 出
#     command= 那一行做 `[ -f ]`，不改写就会读着 /opt/... 把已安装的服务判成 NOT INSTALLED。
if [ "$ROOT_DIR" = "$DEFAULT_ROOT" ]; then
  install -m 0755 "$INIT_SOURCE" "$INIT_TARGET"
else
  sed "s|$(escape_sed "$DEFAULT_ROOT")|$(escape_sed "$ROOT_DIR")|g" "$INIT_SOURCE" > "$TMP_INIT"
  install -m 0755 "$TMP_INIT" "$INIT_TARGET"
fi

# conf.d 由本脚本生成：只管理 SPLAYER_ATOM_ROOT（仅非默认安装根时）与 command_user 两行，
# 其余行（用户自己加的 export / 覆盖项）原样保留。
{
  echo "$CONF_HEADER"
  if [ "$ROOT_DIR" != "$DEFAULT_ROOT" ]; then
    echo "SPLAYER_ATOM_ROOT=\"$ROOT_DIR\""
  fi
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
echo "Wrote $CONF_TARGET (install root: $ROOT_DIR)"
if [ "$MODE" = diretta ]; then
  echo "Mode: Diretta/root"
else
  echo "Mode: ALSA user $SERVICE_USER"
fi

# 装完立刻用 GP 自己的探针复核一次：这一步能拦住「服务能跑但菜单显示 NOT INSTALLED」
# 这类静默集成缺陷（探针只认 command= 的字面路径，不解析变量）。
if [ -f "$GP_PROBE" ]; then
  PROBE_OUTPUT=$(bash "$GP_PROBE" "$SERVICE_NAME" 2>/dev/null | tr '\n' ' ' || true)
  echo "GentooPlayer probe (values.sh $SERVICE_NAME): ${PROBE_OUTPUT:-<no output>}"
  case "$PROBE_OUTPUT" in
    *"NOT INSTALLED"*)
      echo "SPlayer Atom Core: WARNING GentooPlayer reports NOT INSTALLED — check the literal command= line in $INIT_TARGET" >&2
      ;;
  esac
fi

echo "Review the service script, then run:"
echo "  rc-update add $SERVICE_NAME default"
echo "  rc-service $SERVICE_NAME start"
