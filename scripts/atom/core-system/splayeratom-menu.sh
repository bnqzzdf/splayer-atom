#!/bin/sh
# 生成 /opt/{.gentooplayer,script-server}/web/conf/runners/zz_splayeratom_ctl.json。
# 安装器与 CONFIG 开机钩子共用；幂等，菜单序号稳定。
set -u
export LC_ALL=C LANG=C

SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
ATOM_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PORT=14558
if [ -f "$ATOM_DIR/splayeratom.conf" ]; then
    . "$ATOM_DIR/splayeratom.conf"
fi
PORT=${ATOM_SERVER_PORT:-$PORT}

RUNNERS=""
for base in /opt/.gentooplayer /opt/script-server; do
    if [ -d "$base/web/conf/runners" ]; then
        RUNNERS="$base/web/conf/runners"
        break
    fi
done
[ -n "$RUNNERS" ] || exit 0

SELF_CARD=zz_splayeratom_ctl
SELF_GROUP="01. 播放设置"
SEQ_FILE="/audiosys/.asd-cardseq/$SELF_CARD"

allocate_seq() {
    _self="$RUNNERS/$SELF_CARD.json"
    _current=""
    if [ -f "$_self" ]; then
        _current=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)\..*/\1/p' "$_self" 2>/dev/null | head -1)
    fi
    _use_group=0
    for _f in "$RUNNERS"/*.json; do
        [ -f "$_f" ] || continue
        [ "$(basename "$_f" .json)" = "$SELF_CARD" ] && continue
        if [ "$(sed -n 's/.*"group"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_f" 2>/dev/null | head -1)" = "$SELF_GROUP" ]; then
            _use_group=1
            break
        fi
    done
    _used=" "
    for _f in "$RUNNERS"/*.json; do
        [ -f "$_f" ] || continue
        [ "$(basename "$_f" .json)" = "$SELF_CARD" ] && continue
        if [ "$_use_group" = "1" ]; then
            [ "$(sed -n 's/.*"group"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_f" 2>/dev/null | head -1)" = "$SELF_GROUP" ] || continue
        fi
        _n=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)\..*/\1/p' "$_f" 2>/dev/null | head -1)
        [ -n "$_n" ] || continue
        _d=$((10#$_n))
        [ "$_d" -ge 1 ] && [ "$_d" -le 97 ] && _used="$_used$_d "
    done
    _saved=""
    if [ -f "$SEQ_FILE" ]; then
        read -r _saved < "$SEQ_FILE" 2>/dev/null || true
    fi
    case "$_saved" in [0-9]|[0-9][0-9]) ;; *) _saved="" ;; esac
    _ret=""
    if [ -n "$_current" ]; then
        _d=$((10#$_current))
        if [ "$_d" -ge 1 ] && [ "$_d" -le 97 ]; then
            case "$_used" in *" $_d "*) : ;; *) _ret=$_d ;; esac
        fi
    fi
    if [ -z "$_ret" ] && [ -n "$_saved" ]; then
        _d=$((10#$_saved))
        if [ "$_d" -ge 1 ] && [ "$_d" -le 97 ]; then
            case "$_used" in *" $_d "*) : ;; *) _ret=$_d ;; esac
        fi
    fi
    if [ -z "$_ret" ]; then
        _max=0
        for _d in $_used; do [ "$_d" -gt "$_max" ] && _max=$_d; done
        _next=$((_max + 1))
        if [ "$_next" -gt 97 ]; then
            _next=1
            while [ "$_next" -le 97 ]; do
                case "$_used" in *" $_next "*) _next=$((_next + 1)) ;; *) break ;; esac
            done
        fi
        [ "$_next" -le 97 ] && _ret=$_next
    fi
    [ -n "$_ret" ] || return 0
    _out=$(printf '%02d' "$_ret")
    mkdir -p "$(dirname "$SEQ_FILE")" 2>/dev/null || true
    printf '%s\n' "$_out" > "$SEQ_FILE" 2>/dev/null || true
    printf '%s' "$_out"
}

SEQ=$(allocate_seq)
[ -n "$SEQ" ] || SEQ=01

LAN_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}')
[ -n "$LAN_IP" ] || LAN_IP="本机IP"

cat > "$RUNNERS/$SELF_CARD.json" <<EOF
{
  "name": "${SEQ}. SPlayer Atom 设置",
  "script_path": "$ATOM_DIR/service/splayeratomctl.sh",
  "description": "> SPlayer Atom = Linux Core + Web Control（本地曲库、播放队列、ALSA/Diretta/UPnP 输出）\\n> start=启动并置开机自启；stop=停止并摘自启；restart=重启；status=只看状态\\n> update=上传 splayer-atom-core-*.tar.gz 升级（保留 data 与登录状态）\\n> Web UI：http://${LAN_IP}:${PORT}",
  "working_directory": "/tmp",
  "group": "$SELF_GROUP",
  "parameters": [
    {
      "name": "动作",
      "param": "-Action",
      "required": true,
      "type": "list",
      "values": ["status", "start", "stop", "restart", "update"],
      "description": "status 只看不改；start/stop 同时决定下次开机是否自启；update 需要选择升级包"
    },
    {
      "name": "升级包",
      "param": "-Pkg",
      "type": "file_upload",
      "required": false,
      "description": "选 update 时使用：选择 splayer-atom-core-*.tar.gz（存面板临时区，24h 自动清理）"
    }
  ]
}
EOF
chmod 0644 "$RUNNERS/$SELF_CARD.json" 2>/dev/null || true
printf '%s\n' "$RUNNERS/$SELF_CARD.json"
