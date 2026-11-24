#!/bin/sh
# AudioSys 菜单后端：管理 /audiosys/splayer-atom-core 的 SPlayer Atom Core。
# 用法：splayeratomctl.sh -Action status|start|stop|restart|update|rollback|boot|enable|disable [-Pkg <tar.gz>] [-Autostart keep|enable|disable] [-KeepNative]
set -u
export LC_ALL=C LANG=C
trap '' PIPE

SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
ATOM_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ATOM_BIN="$ATOM_DIR/bin/splayer-atom-core"
ATOM_ENABLE="$ATOM_DIR/enable"
ATOM_CONF="$ATOM_DIR/splayeratom.conf"
PORT=14558
ATOM_RUN_DIR=${ATOM_RUN_DIR:-/tmp/splayeratom}
ATOM_MANAGE_NATIVE=${ATOM_MANAGE_NATIVE:-auto}
ATOM_NATIVE_UTILS=${ATOM_NATIVE_UTILS:-/opt/script-server/function/utils.sh}
ATOM_SETTING_INF=${ATOM_SETTING_INF:-/tmp/setting.inf}
ATOM_LOG=""
ATOM_CACHE_DIR=""
if [ -f "$ATOM_CONF" ]; then
    . "$ATOM_CONF"
fi
PORT=${ATOM_SERVER_PORT:-$PORT}
export ATOM_SERVER_PORT="$PORT"
ATOM_LOG=${ATOM_LOG:-$ATOM_RUN_DIR/core.log}
ATOM_CACHE_DIR=${ATOM_CACHE_DIR:-$ATOM_RUN_DIR/cache}
ATOM_PID="$ATOM_RUN_DIR/core.pid"
ATOM_NATIVE_PAUSED="$ATOM_RUN_DIR/native-paused"
ATOM_LOCK_DIR="$ATOM_RUN_DIR/ctl.lock"
LOCK_HELD=0

detect_lan_ip() {
    _ip=$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
    if [ -z "$_ip" ]; then
        _ip=$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')
    fi
    printf '%s' "${_ip:-本机IP}"
}

LAN_IP=$(detect_lan_ip)

pids_of() {
    pgrep -f "$ATOM_DIR/app/index.js" 2>/dev/null | tr '\n' ' '
}

is_running() {
    [ -n "$(pids_of)" ]
}

port_up() {
    if command -v ss >/dev/null 2>&1; then
        ss -lnt 2>/dev/null | awk '{print $4}' | grep -q ":$PORT\$"
    else
        netstat -lnt 2>/dev/null | awk '{print $4}' | grep -q ":$PORT\$"
    fi
}

ensure_link() {
    mkdir -p /usr/local/bin 2>/dev/null || true
    ln -sf "$SELF" /usr/local/bin/splayeratomctl 2>/dev/null || true
}

acquire_lock() {
    mkdir -p "$ATOM_RUN_DIR" 2>/dev/null || return 1
    _i=0
    while [ "$_i" -lt 60 ]; do
        if mkdir "$ATOM_LOCK_DIR" 2>/dev/null; then
            printf '%s\n' "$$" > "$ATOM_LOCK_DIR/pid" 2>/dev/null || true
            LOCK_HELD=1
            return 0
        fi
        _owner=$(cat "$ATOM_LOCK_DIR/pid" 2>/dev/null || true)
        if [ -n "$_owner" ] && ! kill -0 "$_owner" 2>/dev/null; then
            rm -rf "$ATOM_LOCK_DIR" 2>/dev/null || true
            continue
        fi
        sleep 0.5 2>/dev/null || sleep 1
        _i=$((_i + 1))
    done
    echo "[Atom] 另一个管理操作正在进行，请稍后重试。" >&2
    return 1
}

release_lock() {
    if [ "$LOCK_HELD" = "1" ]; then
        rm -rf "$ATOM_LOCK_DIR" 2>/dev/null || true
        LOCK_HELD=0
    fi
}

native_enabled() {
    [ "$ATOM_MANAGE_NATIVE" != "0" ] || return 1
    [ -f "$ATOM_NATIVE_UTILS" ] || return 1
    command -v bash >/dev/null 2>&1 || return 1
    return 0
}

native_mode() {
    [ -f "$ATOM_SETTING_INF" ] || return 0
    tr -d '\r' < "$ATOM_SETTING_INF" 2>/dev/null | sed -n 's/^PlayerMode=//p' | head -1
}

native_pause() {
    native_enabled || return 0
    [ ! -f "$ATOM_NATIVE_PAUSED" ] || return 0
    mkdir -p "$ATOM_RUN_DIR" 2>/dev/null || return 1
    echo "[Atom] 暂停 AudioSys 原生播放器并释放网卡..."
    if ! bash -c '
        set -u
        . "$1"
        mode=""
        memory=""
        if [ -f "$2" ]; then
            mode=$(tr -d "\r" < "$2" | sed -n "s/^PlayerMode=//p" | head -1)
            memory=$(tr -d "\r" < "$2" | sed -n "s/^RoonServerMemoryMode=//p" | head -1)
        fi
        kill_app "/dpdk/renderer" >/dev/null 2>&1 || true
        close_apps >/dev/null 2>&1 || true
        case "$mode" in
            tinyLMS) save_tinylms_data || exit 1 ;;
            splayer) save_splayer_data || exit 1 ;;
            roonServer)
                if [ "$memory" = enable ]; then
                    save_roon_data || exit 1
                fi
                ;;
        esac
        if [ -x /dpdk/dpdk_control.sh ]; then
            /dpdk/dpdk_control.sh unbind-all || exit 1
        elif declare -F wait_dpdk_release >/dev/null; then
            wait_dpdk_release || exit 1
        fi
    ' _ "$ATOM_NATIVE_UTILS" "$ATOM_SETTING_INF"; then
        echo "[Atom] 暂停原生播放器或释放 DPDK 网卡失败，未启动 Atom。" >&2
        return 1
    fi
    touch "$ATOM_NATIVE_PAUSED" 2>/dev/null || true
    return 0
}

native_resume() {
    [ -f "$ATOM_NATIVE_PAUSED" ] || return 0
    rm -f "$ATOM_NATIVE_PAUSED" 2>/dev/null || true
    native_enabled || return 0
    echo "[Atom] 恢复 AudioSys 原生播放器..."
    if ! bash -c '
        set -u
        . "$1"
        restart_apps
    ' _ "$ATOM_NATIVE_UTILS"; then
        echo "[Atom] 警告：恢复原生播放器失败，请检查原厂播放模式页面。" >&2
        return 1
    fi
    return 0
}

rotate_log() {
    [ -f "$ATOM_LOG" ] || return 0
    _sz=$(wc -c < "$ATOM_LOG" 2>/dev/null || echo 0)
    if [ "$_sz" -ge 4194304 ] 2>/dev/null; then
        mv -f "$ATOM_LOG" "$ATOM_LOG.1" 2>/dev/null || true
    fi
}

kill_atom_pids() {
    _pids=$(pids_of)
    [ -n "$_pids" ] || return 0
    for _pid in $_pids; do kill "$_pid" 2>/dev/null || true; done
    _i=0
    while [ "$_i" -lt 15 ]; do
        sleep 1
        _i=$((_i + 1))
        is_running || return 0
    done
    _pids=$(pids_of)
    if [ -n "$_pids" ]; then
        echo "[Atom] SIGTERM 后 15s 未退出，强制结束（pid=$_pids）..." >&2
        for _pid in $_pids; do kill -9 "$_pid" 2>/dev/null || true; done
        sleep 1
    fi
    ! is_running
}

do_start() {
    ensure_link
    [ -x "$ATOM_BIN" ] || { echo "[Atom] 缺少启动器：$ATOM_BIN" >&2; return 1; }
    mkdir -p "$ATOM_RUN_DIR" "$ATOM_CACHE_DIR" "$ATOM_DIR/data" "$(dirname "$ATOM_LOG")" 2>/dev/null \
        || { echo "[Atom] 无法创建运行目录：$ATOM_RUN_DIR" >&2; return 1; }
    rm -f "$ATOM_RUN_DIR/boot.cancelled" 2>/dev/null || true
    if is_running; then
        echo "[Atom] 已在运行（pid=$(pids_of)），无需重复启动。"
        echo "       Web UI：http://$LAN_IP:$PORT"
        return 0
    fi
    if port_up; then
        echo "[Atom] 端口 $PORT 已被其他进程占用，请先停止冲突服务或修改 splayeratom.conf。" >&2
        return 1
    fi
    native_pause || return 1
    rotate_log
    echo "[Atom] 启动 SPlayer Atom Core（端口 $PORT）..."
    rm -f "$ATOM_PID" 2>/dev/null || true
    (
        cd "$ATOM_DIR" || exit 1
        # 清理宿主或其他播放器的运行时覆盖与预加载变量，确保使用包内运行时。
        unset LD_PRELOAD MALLOC_CONF EF_POLL_USEC ATOM_NODE_BIN ATOM_BUN_BIN
        export NODE_ENV=production
        export ATOM_APP_PACKAGED=1
        export ATOM_DATA_DIR="$ATOM_DIR/data"
        export ATOM_CACHE_DIR="$ATOM_CACHE_DIR"
        export ATOM_RESOURCES_DIR="$ATOM_DIR"
        export ATOM_LOG_STDIO_ONLY=1
        export ATOM_SERVER_PORT="$PORT"
        if command -v setsid >/dev/null 2>&1; then
            setsid "$ATOM_BIN" >>"$ATOM_LOG" 2>&1 </dev/null &
        else
            "$ATOM_BIN" >>"$ATOM_LOG" 2>&1 </dev/null &
        fi
        printf '%s\n' "$!" > "$ATOM_PID" 2>/dev/null || true
    )
    _launch_pid=$(cat "$ATOM_PID" 2>/dev/null || true)
    _i=0
    _seen=0
    while [ "$_i" -lt 30 ]; do
        sleep 1
        _i=$((_i + 1))
        if is_running; then
            _seen=1
            if port_up; then
                pids_of | awk '{print $1}' > "$ATOM_PID" 2>/dev/null || true
                echo "[Atom] 已启动（${_i}s，pid=$(pids_of)）。"
                echo "       Web UI：http://$LAN_IP:$PORT"
                return 0
            fi
        elif [ "$_seen" = "1" ] || { [ -n "$_launch_pid" ] && ! kill -0 "$_launch_pid" 2>/dev/null; }; then
            break
        fi
    done
    if is_running; then
        pids_of | awk '{print $1}' > "$ATOM_PID" 2>/dev/null || true
        echo "[Atom] 进程已运行（pid=$(pids_of)），但 30s 内未检测到端口 $PORT 监听。" >&2
        echo "       请查看日志：$ATOM_LOG" >&2
        tail -n 8 "$ATOM_LOG" 2>/dev/null >&2 || true
        return 0
    fi
    echo "[Atom] 启动失败，进程已退出。请查看 $ATOM_LOG" >&2
    tail -n 12 "$ATOM_LOG" 2>/dev/null >&2 || true
    kill_atom_pids >/dev/null 2>&1 || true
    rm -f "$ATOM_PID" 2>/dev/null || true
    native_resume || true
    return 1
}

do_stop() {
    _keep_native=${1:-0}
    if [ "$_keep_native" != "1" ]; then
        mkdir -p "$ATOM_RUN_DIR" 2>/dev/null || true
        touch "$ATOM_RUN_DIR/boot.cancelled" 2>/dev/null || true
    fi
    _pids=$(pids_of)
    if [ -z "$_pids" ]; then
        rm -f "$ATOM_PID" 2>/dev/null || true
        echo "[Atom] 未运行。"
        [ "$_keep_native" = "1" ] || native_resume || true
        return 0
    fi
    echo "[Atom] 停止 SPlayer Atom Core（pid=$_pids）..."
    if ! kill_atom_pids; then
        echo "[Atom] 警告：进程仍在运行（pid=$(pids_of)）。请查看日志。" >&2
        return 1
    fi
    rm -f "$ATOM_PID" 2>/dev/null || true
    echo "[Atom] 已停止。"
    [ "$_keep_native" = "1" ] || native_resume || true
    return 0
}

find_boot_ancestor() {
    _pid=$$
    while [ "$_pid" -gt 1 ] 2>/dev/null; do
        _cmd=$(tr '\0' ' ' < "/proc/$_pid/cmdline" 2>/dev/null || true)
        case "$_cmd" in
            *"/dpdk/diretta.sh"*)
                printf '%s' "$_pid"
                return 0
                ;;
        esac
        _stat=$(cat "/proc/$_pid/stat" 2>/dev/null || true)
        [ -n "$_stat" ] || return 1
        _rest=${_stat##*\) }
        set -- $_rest
        _pid=${2:-0}
    done
    return 1
}

pid_alive_non_zombie() {
    [ -r "/proc/$1/stat" ] || return 1
    _stat=$(cat "/proc/$1/stat" 2>/dev/null || true)
    [ -n "$_stat" ] || return 1
    _rest=${_stat##*\) }
    set -- $_rest
    [ "${1:-Z}" != "Z" ]
}

do_boot() {
    ensure_link
    _menu="$ATOM_DIR/service/splayeratom-menu.sh"
    if [ -x "$_menu" ]; then
        sh "$_menu" >/dev/null 2>&1 || true
    fi
    [ -f "$ATOM_ENABLE" ] || return 0
    mkdir -p "$ATOM_RUN_DIR" 2>/dev/null || return 0
    [ ! -e "$ATOM_RUN_DIR/boot.done" ] || return 0
    touch "$ATOM_RUN_DIR/boot.done" 2>/dev/null || true
    _boot_pid=$(find_boot_ancestor || true)
    (
        if [ -n "$_boot_pid" ]; then
            # 沿祖先进程定位的 diretta.sh 才是开机主流程，不受后台网络挂载子 shell 干扰。
            _w=0
            while [ "$_w" -lt 180 ] && pid_alive_non_zombie "$_boot_pid"; do
                sleep 1
                _w=$((_w + 1))
            done
            sleep 2
        else
            _w=0
            while [ "$_w" -lt 60 ] && pgrep -f '/dpdk/diretta.sh' >/dev/null 2>&1; do
                sleep 1
                _w=$((_w + 1))
            done
            [ "$_w" -gt 0 ] && sleep 2 || sleep 10
        fi
        [ -f "$ATOM_ENABLE" ] || exit 0
        [ ! -e "$ATOM_RUN_DIR/boot.cancelled" ] || exit 0
        "$SELF" -Action start >/dev/null 2>&1
    ) </dev/null >/dev/null 2>&1 &
    return 0
}

do_status() {
    echo "========== SPlayer Atom Core 状态 =========="
    _pids=$(pids_of)
    if [ -n "$_pids" ]; then
        echo "  进程      : 运行中 pid=$_pids"
    else
        echo "  进程      : 未运行"
    fi
    _version=$(sed -n 's/.*"atomVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ATOM_DIR/runtime.json" 2>/dev/null | head -1)
    _commit=$(sed -n 's/.*"atomCommit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ATOM_DIR/runtime.json" 2>/dev/null | head -1)
    [ -n "$_commit" ] && _commit=$(printf '%.8s' "$_commit")
    echo "  版本      : ${_version:-unknown}${_commit:+ (${_commit})}"
    echo "  安装根    : $ATOM_DIR"
    if port_up; then
        echo "  端口 $PORT : LISTEN"
    else
        echo "  端口 $PORT : -"
    fi
    if [ -f "$ATOM_ENABLE" ]; then
        echo "  开机自启  : 开启"
    else
        echo "  开机自启  : 关闭"
    fi
    _mode=$(native_mode)
    if [ -n "$_mode" ]; then
        if [ -f "$ATOM_NATIVE_PAUSED" ]; then
            echo "  原生模式  : $_mode（已由 Atom 接管，停止后恢复）"
        else
            echo "  原生模式  : $_mode"
        fi
    fi
    echo "  Web UI    : http://$LAN_IP:$PORT"
    echo "  数据目录  : $ATOM_DIR/data"
    echo "  日志文件  : $ATOM_LOG"
    echo
    echo "---- 最近日志（$ATOM_LOG 末 8 行）----"
    tail -n 8 "$ATOM_LOG" 2>/dev/null || echo "  (无)"
}

do_update() {
    _installer="$ATOM_DIR/install.sh"
    [ -f "$_installer" ] || { echo "[Atom] 缺少安装器：$_installer" >&2; return 1; }
    _pkg=${PKG:-}
    if [ -n "$_pkg" ]; then
        [ -f "$_pkg" ] || { echo "[Atom] 上传的升级包不存在：$_pkg" >&2; return 1; }
    else
        _dirs="$ATOM_DIR /audiosys /tmp /root"
        for _d in /mnt/* /media/*; do [ -d "$_d" ] && _dirs="$_dirs $_d"; done
        for _d in $_dirs; do
            [ -d "$_d" ] || continue
            for _f in $(ls -t "$_d"/splayer-atom-core-*.tar.gz 2>/dev/null); do
                [ -f "$_f" ] && { _pkg=$_f; break; }
            done
            [ -n "$_pkg" ] && break
        done
        [ -n "$_pkg" ] || { echo "[Atom] 没有升级包；请用「升级包」上传，或放到 /audiosys 下。" >&2; return 1; }
    fi
    case "$_pkg" in
        *.tar.gz|*.tgz) ;;
        *) echo "[Atom] 升级包应为 splayer-atom-core-*.tar.gz：$_pkg" >&2; return 1 ;;
    esac
    _tmp="/tmp/splayeratom-update.$$"
    rm -rf "$_tmp"
    mkdir -p "$_tmp" || return 1
    echo "[Atom] 解包升级包：$_pkg"
    if ! tar -xzf "$_pkg" -C "$_tmp"; then
        rm -rf "$_tmp"
        echo "[Atom] 解包失败。" >&2
        return 1
    fi
    _top=""
    for _d in "$_tmp"/*; do
        if [ -f "$_d/install.sh" ] && [ -f "$_d/variants/manifest.txt" ]; then
            _top=$_d
            break
        fi
    done
    if [ -z "$_top" ]; then
        rm -rf "$_tmp"
        echo "[Atom] 升级包内没有 install.sh + variants/manifest.txt。" >&2
        return 1
    fi
    # 升级调用的新安装器内部会再次调用 splayeratomctl，必须先释放锁避免自锁。
    release_lock
    echo "[Atom] 运行新安装器（保留 data/）..."
    sh "$_top/install.sh" --prefix "$ATOM_DIR" --cpu auto --init audiosys
    _rc=$?
    rm -rf "$_tmp"
    if [ "$_rc" -eq 0 ]; then
        echo "[Atom] 升级完成。"
    else
        echo "[Atom] 升级失败（rc=$_rc）；旧程序和 data/ 仍在。" >&2
    fi
    return "$_rc"
}

do_rollback() {
    _installer="$ATOM_DIR/install.sh"
    [ -f "$_installer" ] || { echo "[Atom] 缺少安装器：$_installer" >&2; return 1; }
    release_lock
    echo "[Atom] 回滚到上一版本（保留 data/）..."
    sh "$_installer" --prefix "$ATOM_DIR" --init audiosys --rollback
}

apply_autostart() {
    case "$AUTOSTART" in
        keep|"") return 0 ;;
        enable)
            touch "$ATOM_ENABLE" 2>/dev/null || { echo "[Atom] 无法写 enable：$ATOM_ENABLE" >&2; return 1; }
            echo "[Atom] 开机自启已开启。"
            ;;
        disable)
            rm -f "$ATOM_ENABLE" 2>/dev/null || true
            echo "[Atom] 开机自启已关闭。"
            ;;
        *)
            echo "[Atom] 无效开机自启参数：$AUTOSTART（keep/enable/disable）" >&2
            return 1
            ;;
    esac
}

ACTION=""
PKG=""
AUTOSTART="keep"
KEEP_NATIVE=0
while [ "$#" -ge 1 ]; do
    case "$1" in
        -Action|--Action) ACTION=${2:-}; shift ;;
        -Pkg|--Pkg) PKG=${2:-}; shift ;;
        -Autostart|--Autostart) AUTOSTART=${2:-}; shift ;;
        -KeepNative|--KeepNative) KEEP_NATIVE=1 ;;
        start|stop|restart|status|update|rollback|boot|enable|disable) [ -z "$ACTION" ] && ACTION=$1 ;;
    esac
    shift
done
[ -n "$ACTION" ] || ACTION=status

trap 'release_lock' EXIT HUP INT TERM

rc=0
case "$ACTION" in
    status)
        if [ "$AUTOSTART" != "keep" ]; then
            apply_autostart || rc=$?
        fi
        do_status || rc=$?
        ;;
    enable)
        AUTOSTART=enable
        apply_autostart || rc=$?
        ;;
    disable)
        AUTOSTART=disable
        apply_autostart || rc=$?
        ;;
    boot)
        do_boot || rc=$?
        ;;
    start)
        acquire_lock || exit 1
        do_start || rc=$?
        [ "$rc" -eq 0 ] && { apply_autostart || rc=$?; }
        ;;
    stop)
        acquire_lock || exit 1
        do_stop "$KEEP_NATIVE" || rc=$?
        [ "$rc" -eq 0 ] && { apply_autostart || rc=$?; }
        ;;
    restart)
        acquire_lock || exit 1
        do_stop 1 && { echo; sleep 2; do_start; } || rc=$?
        [ "$rc" -eq 0 ] && { apply_autostart || rc=$?; }
        ;;
    update)
        acquire_lock || exit 1
        do_update || rc=$?
        [ "$rc" -eq 0 ] && { apply_autostart || rc=$?; }
        ;;
    rollback)
        acquire_lock || exit 1
        do_rollback || rc=$?
        [ "$rc" -eq 0 ] && { apply_autostart || rc=$?; }
        ;;
    *)
        echo "[Atom] 未知动作：$ACTION（start/stop/restart/status/update/rollback/enable/disable）" >&2
        exit 1
        ;;
esac
release_lock
exit "$rc"
