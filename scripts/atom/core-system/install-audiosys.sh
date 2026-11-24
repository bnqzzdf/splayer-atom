#!/bin/sh
# AudioSys 安装适配：优先写入官方增量目录 auto_start.sh，旧固件回退 CONFIG/networkfs.sh，并建软链与菜单卡片。
# 用法：install-audiosys.sh install|uninstall
set -u
export LC_ALL=C LANG=C

SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
SERVICE_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
ATOM_DIR=$(CDPATH= cd -- "$SERVICE_DIR/.." && pwd)
CTL="$ATOM_DIR/service/splayeratomctl.sh"
MENU="$ATOM_DIR/service/splayeratom-menu.sh"
HOOK_BEGIN='# >>> splayeratom (added by install-audiosys.sh) >>>'
HOOK_END='# <<< splayeratom <<<'
SCRIPT_SERVER_LIVE=${ATOM_SCRIPT_SERVER_LIVE:-/opt/script-server}
SCRIPT_SERVER_SYNC=${ATOM_SCRIPT_SERVER_SYNC:-/audiosys/sync/opt/script-server}
CFG_MNT=""
CFG_OWN_MOUNT=0
CFG_REMOUNT_RO=0

die() { echo "[AtomAudioSys] $*" >&2; exit 1; }
info() { echo "[AtomAudioSys] $*"; }
warn() { echo "[AtomAudioSys][WARN] $*" >&2; }

use_auto_start() {
    [ -f "$SCRIPT_SERVER_LIVE/function/utils.sh" ] && [ -d "${ATOM_AUDIOSYS_DIR:-/audiosys}" ]
}

check_script_syntax() {
    if command -v bash >/dev/null 2>&1; then
        bash -n "$1" 2>/dev/null
    else
        sh -n "$1" 2>/dev/null
    fi
}

find_cfg() {
    CFG_MNT=""
    CFG_OWN_MOUNT=0
    CFG_REMOUNT_RO=0
    for m in /mnt/cfg /mnt/config /mnt/CONFIG /media/cfg; do
        if [ -f "$m/networkfs.sh" ]; then
            CFG_MNT=$m
            return 0
        fi
    done
    dev=""
    if [ -r /tmp/config_drv ]; then
        dev=$(cat /tmp/config_drv 2>/dev/null)
    fi
    if [ -z "$dev" ] && command -v blkid >/dev/null 2>&1; then
        dev=$(blkid -L CONFIG 2>/dev/null)
    fi
    if [ -z "$dev" ] && [ -L /dev/disk/by-label/CONFIG ]; then
        dev=$(readlink -f /dev/disk/by-label/CONFIG 2>/dev/null)
    fi
    [ -n "$dev" ] || return 1

    mounted=$(awk -v d="$dev" '$1==d {print $2; exit}' /proc/self/mounts)
    if [ -n "$mounted" ] && [ -f "$mounted/networkfs.sh" ]; then
        CFG_MNT=$mounted
        opts=$(awk -v d="$dev" '$1==d {print $4; exit}' /proc/self/mounts)
        case ",$opts," in
            *,ro,*) mount -o remount,rw "$mounted" 2>/dev/null && CFG_REMOUNT_RO=1 ;;
        esac
        return 0
    fi

    mp="/mnt/.splayeratom-config.$$"
    mkdir -p "$mp" 2>/dev/null || return 1
    if ! mount -o rw "$dev" "$mp" 2>/dev/null; then
        rmdir "$mp" 2>/dev/null
        return 1
    fi
    if [ ! -f "$mp/networkfs.sh" ]; then
        umount "$mp" 2>/dev/null
        rmdir "$mp" 2>/dev/null
        return 1
    fi
    CFG_MNT=$mp
    CFG_OWN_MOUNT=1
    return 0
}

release_cfg() {
    [ -n "$CFG_MNT" ] || return 0
    sync 2>/dev/null || true
    if [ "$CFG_OWN_MOUNT" = "1" ]; then
        umount "$CFG_MNT" 2>/dev/null || umount -l "$CFG_MNT" 2>/dev/null || true
        rmdir "$CFG_MNT" 2>/dev/null || true
    elif [ "$CFG_REMOUNT_RO" = "1" ]; then
        mount -o remount,ro "$CFG_MNT" 2>/dev/null || true
    fi
    CFG_MNT=""
    CFG_OWN_MOUNT=0
    CFG_REMOUNT_RO=0
}

strip_hook() {
    skip=0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "$HOOK_BEGIN"*) skip=1; continue ;;
            "$HOOK_END"*) skip=0; continue ;;
        esac
        [ "$skip" = "1" ] || printf '%s\n' "$line"
    done < "$1"
}

append_hook() {
    cat >> "$1" <<EOF

$HOOK_BEGIN
if [ -x "$CTL" ]; then
    "$CTL" -Action boot
fi
$HOOK_END
EOF
}

write_auto_start_hook() {
    src=""
    if [ -f "$SCRIPT_SERVER_SYNC/function/auto_start.sh" ]; then
        src="$SCRIPT_SERVER_SYNC/function/auto_start.sh"
    elif [ -f "$SCRIPT_SERVER_LIVE/function/auto_start.sh" ]; then
        src="$SCRIPT_SERVER_LIVE/function/auto_start.sh"
    fi
    tmp="/tmp/.splayeratom-autostart.$$"
    if [ -n "$src" ]; then
        strip_hook "$src" > "$tmp" || { rm -f "$tmp"; return 1; }
    else
        printf '#!/bin/bash\n' > "$tmp"
    fi
    append_hook "$tmp"
    if ! check_script_syntax "$tmp"; then
        rm -f "$tmp"
        die "生成的 auto_start.sh 语法检查失败，未覆盖原文件"
    fi
    for base in "$SCRIPT_SERVER_SYNC" "$SCRIPT_SERVER_LIVE"; do
        mkdir -p "$base/function" 2>/dev/null || { rm -f "$tmp"; die "无法创建目录：$base/function"; }
        cp "$tmp" "$base/function/auto_start.sh" || { rm -f "$tmp"; die "写入 $base/function/auto_start.sh 失败"; }
        chmod 0755 "$base/function/auto_start.sh" 2>/dev/null || true
    done
    rm -f "$tmp"
    sync 2>/dev/null || true
    info "已写入官方增量开机钩子：$SCRIPT_SERVER_SYNC/function/auto_start.sh"
    return 0
}

remove_auto_start_hook() {
    for base in "$SCRIPT_SERVER_SYNC" "$SCRIPT_SERVER_LIVE"; do
        target="$base/function/auto_start.sh"
        [ -f "$target" ] || continue
        grep -qF "$HOOK_BEGIN" "$target" 2>/dev/null || continue
        tmp="/tmp/.splayeratom-autostart.$$"
        strip_hook "$target" > "$tmp" || { rm -f "$tmp"; continue; }
        if check_script_syntax "$tmp"; then
            cp "$tmp" "$target" 2>/dev/null || true
            chmod 0755 "$target" 2>/dev/null || true
            info "已移除开机钩子：$target"
        else
            warn "剥离钩子后的 $target 语法检查失败，已保留原文件"
        fi
        rm -f "$tmp"
    done
    sync 2>/dev/null || true
}

write_cfg_hook() {
    find_cfg || { warn "未找到 CONFIG 分区（LABEL=CONFIG）；开机钩子未写入"; return 1; }
    hook="$CFG_MNT/networkfs.sh"
    ts=$(date +%Y%m%d-%H%M%S)
    cp -a "$hook" "$hook.bak-splayeratom-$ts" 2>/dev/null || warn "无法备份 $hook"
    tmp="$CFG_MNT/.networkfs.sh.splayeratom.$$"
    strip_hook "$hook" > "$tmp" || { rm -f "$tmp"; release_cfg; return 1; }
    append_hook "$tmp"
    if ! sh -n "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        release_cfg
        die "生成的 networkfs.sh 语法检查失败，未覆盖原文件"
    fi
    cat "$tmp" > "$hook" || { rm -f "$tmp"; release_cfg; die "写入 networkfs.sh 失败"; }
    rm -f "$tmp"
    sync 2>/dev/null || true
    info "已写入开机钩子：$hook"
    release_cfg
    return 0
}

remove_cfg_hook() {
    quiet=${1:-0}
    find_cfg || {
        [ "$quiet" = "1" ] || warn "未找到 CONFIG 分区；钩子可能仍残留"
        return 1
    }
    hook="$CFG_MNT/networkfs.sh"
    if ! grep -qF "$HOOK_BEGIN" "$hook" 2>/dev/null; then
        release_cfg
        [ "$quiet" = "1" ] || info "CONFIG 分区没有 SPlayer Atom 钩子"
        return 0
    fi
    ts=$(date +%Y%m%d-%H%M%S)
    cp -a "$hook" "$hook.bak-splayeratom-$ts" 2>/dev/null || true
    tmp="$CFG_MNT/.networkfs.sh.splayeratom.$$"
    strip_hook "$hook" > "$tmp" || { rm -f "$tmp"; release_cfg; return 1; }
    if ! sh -n "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        release_cfg
        die "剥离钩子后的 networkfs.sh 语法失败，原文件未覆盖"
    fi
    cat "$tmp" > "$hook"
    rm -f "$tmp"
    sync 2>/dev/null || true
    info "已移除 CONFIG 开机钩子"
    release_cfg
    return 0
}

remove_card() {
    for base in /opt/.gentooplayer "$SCRIPT_SERVER_LIVE" "$SCRIPT_SERVER_SYNC"; do
        rm -f "$base/web/conf/runners/zz_splayeratom_ctl.json" 2>/dev/null || true
    done
}

install_all() {
    chmod 0755 "$CTL" "$MENU" 2>/dev/null || true
    mkdir -p /usr/local/bin 2>/dev/null || true
    ln -sf "$CTL" /usr/local/bin/splayeratomctl 2>/dev/null || true
    if [ -x "$MENU" ]; then
        card=$(sh "$MENU" 2>/dev/null || true)
        [ -n "$card" ] && info "菜单卡片：$card"
    fi
    if use_auto_start; then
        write_auto_start_hook || return 1
        # 从旧版 CONFIG 钩子迁移过来时顺手清理，避免开机触发两次。
        remove_cfg_hook 1 || true
    else
        write_cfg_hook || return 1
    fi
}

uninstall_all() {
    remove_card
    if [ -L /usr/local/bin/splayeratomctl ]; then
        target=$(readlink /usr/local/bin/splayeratomctl 2>/dev/null || true)
        [ "$target" = "$CTL" ] && rm -f /usr/local/bin/splayeratomctl
    fi
    remove_auto_start_hook || true
    remove_cfg_hook 1 || true
}

case "${1:-install}" in
    install) install_all ;;
    uninstall) uninstall_all ;;
    *) die "用法：install-audiosys.sh install|uninstall" ;;
esac
exit 0
