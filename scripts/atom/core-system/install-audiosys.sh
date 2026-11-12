#!/bin/sh
# AudioSys 安装适配：写 CONFIG/networkfs.sh 开机钩子、建软链、注入网页菜单卡片。
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
CFG_MNT=""
CFG_OWN_MOUNT=0
CFG_REMOUNT_RO=0

die() { echo "[AtomAudioSys] $*" >&2; exit 1; }
info() { echo "[AtomAudioSys] $*"; }
warn() { echo "[AtomAudioSys][WARN] $*" >&2; }

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
# AudioSys: /opt is RAM-backed. Recreate the control link and web-menu card
# on every boot, and start Atom only when the persistent enable flag exists.
if [ -x "$CTL" ]; then
    mkdir -p /usr/local/bin 2>/dev/null
    ln -sf "$CTL" /usr/local/bin/splayeratomctl 2>/dev/null
    if [ -x "$MENU" ]; then
        sh "$MENU" >/dev/null 2>&1 || true
    fi
    if [ -f "$ATOM_DIR/enable" ] && [ ! -e /tmp/splayeratom-hook.done ]; then
        touch /tmp/splayeratom-hook.done 2>/dev/null || true
        ( sleep 35; "$CTL" -Action start >/dev/null 2>&1 & ) >/dev/null 2>&1 &
    fi
fi
$HOOK_END
EOF
}

write_hook() {
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

remove_hook() {
    find_cfg || { warn "未找到 CONFIG 分区；钩子可能仍残留"; return 1; }
    hook="$CFG_MNT/networkfs.sh"
    if ! grep -qF "$HOOK_BEGIN" "$hook" 2>/dev/null; then
        release_cfg
        info "CONFIG 分区没有 SPlayer Atom 钩子"
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
    info "已移除开机钩子"
    release_cfg
    return 0
}

remove_card() {
    for base in /opt/.gentooplayer /opt/script-server; do
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
    write_hook || return 1
}

uninstall_all() {
    remove_card
    if [ -L /usr/local/bin/splayeratomctl ]; then
        target=$(readlink /usr/local/bin/splayeratomctl 2>/dev/null || true)
        [ "$target" = "$CTL" ] && rm -f /usr/local/bin/splayeratomctl
    fi
    remove_hook || true
}

case "${1:-install}" in
    install) install_all ;;
    uninstall) uninstall_all ;;
    *) die "用法：install-audiosys.sh install|uninstall" ;;
esac
exit 0
