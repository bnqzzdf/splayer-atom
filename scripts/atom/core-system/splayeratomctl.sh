#!/bin/sh
# AudioSys 菜单后端：管理 /audiosys/splayer-atom-core 的 SPlayer Atom Core。
# 用法：splayeratomctl.sh -Action status|start|stop|restart|update [-Pkg <tar.gz>]
set -u
export LC_ALL=C LANG=C
trap '' PIPE

SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
ATOM_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ATOM_BIN="$ATOM_DIR/bin/splayer-atom-core"
ATOM_ENABLE="$ATOM_DIR/enable"
ATOM_LOG_DIR="$ATOM_DIR/logs"
ATOM_LOG="$ATOM_LOG_DIR/core.log"
ATOM_PID="/run/splayeratom.pid"
ATOM_CONF="$ATOM_DIR/splayeratom.conf"
PORT=14558
if [ -f "$ATOM_CONF" ]; then
    . "$ATOM_CONF"
fi
PORT=${ATOM_SERVER_PORT:-$PORT}
export ATOM_SERVER_PORT="$PORT"

LAN_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}')
[ -n "$LAN_IP" ] || LAN_IP="本机IP"

pids_of() {
    pgrep -f "$ATOM_DIR/app/index.js" 2>/dev/null | tr '\n' ' '
}

is_running() {
    [ -n "$(pids_of)" ]
}

port_up() {
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -q ":$PORT\$"
}

ensure_link() {
    mkdir -p /usr/local/bin 2>/dev/null || true
    ln -sf "$SELF" /usr/local/bin/splayeratomctl 2>/dev/null || true
}

do_start() {
    ensure_link
    [ -x "$ATOM_BIN" ] || { echo "[Atom] 缺少启动器：$ATOM_BIN" >&2; return 1; }
    mkdir -p "$ATOM_LOG_DIR" 2>/dev/null || { echo "[Atom] 无法创建日志目录：$ATOM_LOG_DIR" >&2; return 1; }
    touch "$ATOM_ENABLE" 2>/dev/null || { echo "[Atom] 无法写 enable：$ATOM_ENABLE" >&2; return 1; }
    if is_running; then
        echo "[Atom] 已在运行（pid=$(pids_of)），无需重复启动。"
        echo "       Web UI：http://$LAN_IP:$PORT"
        return 0
    fi
    echo "[Atom] 启动 SPlayer Atom Core（端口 $PORT）..."
    cd "$ATOM_DIR" || return 1
    if command -v setsid >/dev/null 2>&1; then
        setsid "$ATOM_BIN" >>"$ATOM_LOG" 2>&1 </dev/null &
    else
        "$ATOM_BIN" >>"$ATOM_LOG" 2>&1 </dev/null &
    fi
    i=0
    while [ "$i" -lt 20 ]; do
        sleep 1
        i=$((i + 1))
        if is_running; then
            pids_of | awk '{print $1}' > "$ATOM_PID" 2>/dev/null || true
            echo "[Atom] 已启动（${i}s，pid=$(pids_of)）。"
            echo "       Web UI：http://$LAN_IP:$PORT"
            return 0
        fi
    done
    echo "[Atom] 警告：20s 内未检测到 Core 进程。请查看 $ATOM_LOG" >&2
    tail -n 8 "$ATOM_LOG" 2>/dev/null >&2 || true
    return 1
}

do_stop() {
    keep_enable=${1:-0}
    if [ "$keep_enable" = "1" ]; then
        echo "[Atom] 重启模式：保留 enable。"
    else
        rm -f "$ATOM_ENABLE" 2>/dev/null
    fi
    pids=$(pids_of)
    if [ -z "$pids" ]; then
        rm -f "$ATOM_PID" 2>/dev/null
        echo "[Atom] 未运行。"
        [ "$keep_enable" = "1" ] || echo "       enable 已摘：下次开机不会自动启动。"
        return 0
    fi
    echo "[Atom] 停止 SPlayer Atom Core（pid=$pids）..."
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
    i=0
    while [ "$i" -lt 15 ]; do
        sleep 1
        i=$((i + 1))
        is_running || break
    done
    if is_running; then
        echo "[Atom] 警告：SIGTERM 后 15s 仍在运行（pid=$(pids_of)）。请查看日志。" >&2
        return 1
    fi
    rm -f "$ATOM_PID" 2>/dev/null
    echo "[Atom] 已停止。"
    [ "$keep_enable" = "1" ] || echo "       enable 已摘：下次开机不会自动启动。"
    return 0
}

do_status() {
    echo "========== SPlayer Atom Core 状态 =========="
    pids=$(pids_of)
    if [ -n "$pids" ]; then
        echo "  进程      : 运行中 pid=$pids"
    else
        echo "  进程      : 未运行"
    fi
    version=$(sed -n 's/.*"atomVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ATOM_DIR/runtime.json" 2>/dev/null | head -1)
    commit=$(sed -n 's/.*"atomCommit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ATOM_DIR/runtime.json" 2>/dev/null | head -1)
    [ -n "$commit" ] && commit=$(printf '%.8s' "$commit")
    echo "  版本      : ${version:-unknown}${commit:+ (${commit})}"
    echo "  安装根    : $ATOM_DIR"
    if port_up; then
        echo "  端口 $PORT : LISTEN"
    else
        echo "  端口 $PORT : -"
    fi
    if [ -f "$ATOM_ENABLE" ]; then
        echo "  开机自启  : enable 存在 ⇒ 自动启动"
    else
        echo "  开机自启  : enable 不存在 ⇒ 不启动"
    fi
    echo "  Web UI    : http://$LAN_IP:$PORT"
    echo
    echo "---- 最近日志（$ATOM_LOG 末 8 行）----"
    tail -n 8 "$ATOM_LOG" 2>/dev/null || echo "  (无)"
}

do_update() {
    installer="$ATOM_DIR/install.sh"
    [ -f "$installer" ] || { echo "[Atom] 缺少安装器：$installer" >&2; return 1; }
    pkg=${PKG:-}
    if [ -n "$pkg" ]; then
        [ -f "$pkg" ] || { echo "[Atom] 上传的升级包不存在：$pkg" >&2; return 1; }
    else
        dirs="$ATOM_DIR /audiosys /tmp /root"
        for d in /mnt/* /media/*; do [ -d "$d" ] && dirs="$dirs $d"; done
        for d in $dirs; do
            [ -d "$d" ] || continue
            for f in $(ls -t "$d"/splayer-atom-core-*.tar.gz 2>/dev/null); do
                [ -f "$f" ] && { pkg=$f; break; }
            done
            [ -n "$pkg" ] && break
        done
        [ -n "$pkg" ] || { echo "[Atom] 没有升级包；请用「升级包」上传，或放到 /audiosys 下。" >&2; return 1; }
    fi
    case "$pkg" in
        *.tar.gz|*.tgz) ;;
        *) echo "[Atom] 升级包应为 splayer-atom-core-*.tar.gz：$pkg" >&2; return 1 ;;
    esac
    tmp="/tmp/splayeratom-update.$$"
    rm -rf "$tmp"
    mkdir -p "$tmp" || return 1
    trap 'rm -rf "$tmp"' EXIT HUP INT TERM
    echo "[Atom] 解包升级包：$pkg"
    if ! tar -xzf "$pkg" -C "$tmp"; then
        echo "[Atom] 解包失败。" >&2
        return 1
    fi
    top=""
    for d in "$tmp"/*; do
        if [ -f "$d/install.sh" ] && [ -f "$d/variants/manifest.txt" ]; then
            top=$d
            break
        fi
    done
    [ -n "$top" ] || { echo "[Atom] 升级包内没有 install.sh + variants/manifest.txt。" >&2; return 1; }
    echo "[Atom] 运行新安装器（保留 data/）..."
    sh "$top/install.sh" --prefix "$ATOM_DIR" --cpu auto --init audiosys
    rc=$?
    if [ "$rc" -eq 0 ]; then
        echo "[Atom] 升级完成。"
    else
        echo "[Atom] 升级失败（rc=$rc）；旧程序和 data/ 仍在。" >&2
    fi
    return "$rc"
}

ACTION=""
PKG=""
while [ "$#" -ge 1 ]; do
    case "$1" in
        -Action|--Action) ACTION=${2:-}; shift ;;
        -Pkg|--Pkg) PKG=${2:-}; shift ;;
        start|stop|restart|status|update) [ -z "$ACTION" ] && ACTION=$1 ;;
    esac
    shift
done
[ -n "$ACTION" ] || ACTION=status

case "$ACTION" in
    start) do_start ;;
    stop) do_stop ;;
    restart) do_stop 1 && { echo; sleep 2; do_start; } ;;
    status) do_status ;;
    update) do_update ;;
    *)
        echo "[Atom] 未知动作：$ACTION（start/stop/restart/status/update）" >&2
        exit 1
        ;;
esac
exit $?
