#!/bin/sh
# SPlayer Atom Core 多架构安装器
#
# 用法：
#   ./install.sh                         # 自动检测 CPU 变体，安装到 /opt/splayer-atom-core
#   ./install.sh --cpu v3                # 指定变体
#   ./install.sh --cpu auto --prefix /audiosys/splayer-atom-core
#   ./install.sh --init systemd|openrc|none
#   ./install.sh --user splayer-atom     # 默认 root（Diretta 需要）
#   ./install.sh --force                 # 允许使用非空且非 Atom 的安装根（有覆盖风险）
#   ./install.sh --uninstall             # 保留 data/
#   ./install.sh --uninstall --purge     # 连 data/ 一起删除
#   ./install.sh --rollback              # 恢复最近一次安装备份
#
# 包内变体：x86_64 为 v1/v2/v3/v4/zen4；aarch64 为 arm64。
# v1 是 ALSA-only（SDK 148 没有 x86 v1 Diretta 库）。
set -eu
export LC_ALL=C LANG=C

DEFAULT_PREFIX=/opt/splayer-atom-core
PREFIX=$DEFAULT_PREFIX
CPU=auto
INIT=auto
SERVICE_USER=""
ACTION=install
PURGE=0
FORCE=0

die() { echo "[install] $*" >&2; exit 1; }
info() { echo "[install] $*"; }
warn() { echo "[install][WARN] $*" >&2; }

usage() { sed -n '2,/^set -eu/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'; }

while [ $# -gt 0 ]; do
    case "$1" in
        --prefix) PREFIX=${2:-}; shift ;;
        --prefix=*) PREFIX=${1#*=} ;;
        --cpu) CPU=${2:-}; shift ;;
        --cpu=*) CPU=${1#*=} ;;
        --init) INIT=${2:-}; shift ;;
        --init=*) INIT=${1#*=} ;;
        --user) SERVICE_USER=${2:-}; shift ;;
        --user=*) SERVICE_USER=${1#*=} ;;
        --uninstall) ACTION=uninstall ;;
        --rollback) ACTION=rollback ;;
        --purge) PURGE=1 ;;
        --force) FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        *) die "未知参数：$1（用 --help）" ;;
    esac
    shift
done

[ "$(id -u)" = 0 ] || die "需要 root 运行"
[ -n "$PREFIX" ] || die "--prefix 不能为空"
case "$PREFIX" in /*) ;; *) die "--prefix 必须是绝对路径" ;; esac

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -f "$ROOT/PACKAGE_ARCH" ] || die "包不完整：缺少 PACKAGE_ARCH（请在解包目录运行 install.sh）"
[ -f "$ROOT/variants/manifest.txt" ] || die "包不完整：缺少 variants/manifest.txt"
PKG_ARCH=$(cat "$ROOT/PACKAGE_ARCH")
case "$PKG_ARCH" in
    x86_64|aarch64) ;;
    *) die "PACKAGE_ARCH 非法：$PKG_ARCH" ;;
esac

case "$(uname -m)" in
    x86_64|amd64) HOST_ARCH=x86_64 ;;
    aarch64|arm64) HOST_ARCH=aarch64 ;;
    *) die "本机架构不支持：$(uname -m)（仅 x86_64/aarch64）" ;;
esac
[ "$PKG_ARCH" = "$HOST_ARCH" ] || die "包架构 $PKG_ARCH 与本机 $HOST_ARCH 不一致，拒绝安装"

looks_like_atom_install() {
    [ -f "$PREFIX/bin/splayer-atom-core" ] \
        || [ -f "$PREFIX/runtime.json" ] \
        || [ -f "$PREFIX/PACKAGE_ARCH" ] \
        || [ -f "$PREFIX/app/index.js" ]
}
if [ -d "$PREFIX" ] \
   && [ -n "$(find "$PREFIX" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ] \
   && ! looks_like_atom_install \
   && [ "$FORCE" != 1 ]; then
    die "目标目录非空且不像 Atom 安装根：$PREFIX
为避免误删现有文件，请改用专用子目录（例如 --prefix /audiosys/splayer-atom-core），
或确认目录内容后加 --force。安装未开始。"
fi

VARIANT_DIRS=$ROOT/variants
manifest_variants=$(sed -n 's/^variants=//p' "$ROOT/variants/manifest.txt" | head -1)
[ -n "$manifest_variants" ] || die "manifest 缺少 variants 列表"

detect_cpu() {
    if [ "$HOST_ARCH" = aarch64 ]; then
        echo arm64
        return
    fi
    flags=$(grep -m1 '^flags' /proc/cpuinfo 2>/dev/null || true)
    vendor=$(grep -m1 '^vendor_id' /proc/cpuinfo 2>/dev/null | awk '{print $3}' || true)
    family=$(grep -m1 '^cpu family' /proc/cpuinfo 2>/dev/null | awk '{print $4}' || true)
    case "$flags" in
        *avx512f*)
            if [ "$vendor" = AuthenticAMD ] && { [ "$family" = 25 ] || [ "$family" = 26 ]; }; then
                echo zen4
            else
                echo v4
            fi
            ;;
        *avx2*) echo v3 ;;
        *sse4_2*) echo v2 ;;
        *) echo v1 ;;
    esac
}

HOST_CPU=$(detect_cpu)
if [ "$CPU" = auto ]; then
    case "$HOST_CPU" in
        zen4) candidates="zen4 v4 v3 v2 v1" ;;
        v4) candidates="v4 v3 v2 v1" ;;
        v3) candidates="v3 v2 v1" ;;
        v2) candidates="v2 v1" ;;
        v1) candidates="v1" ;;
        arm64) candidates="arm64" ;;
        *) candidates="v1" ;;
    esac
    for candidate in $candidates; do
        case " $manifest_variants " in
            *" $candidate "*) CPU=$candidate; break ;;
        esac
    done
    [ "$CPU" != auto ] || die "包内没有本机可运行的变体（本机 $HOST_ARCH/$HOST_CPU，包内 $manifest_variants）"
else
    case " $manifest_variants " in
        *" $CPU "*) ;;
        *) die "包内没有变体 $CPU；可用：$manifest_variants" ;;
    esac
fi
[ -d "$VARIANT_DIRS/$CPU/native" ] || die "变体目录不存在：$VARIANT_DIRS/$CPU/native"
if [ "$CPU" = v1 ]; then
    warn "v1 是 ALSA-only 变体（无 Diretta）；需要 Diretta 请选择 v2/v3/v4/zen4。"
fi

detect_init() {
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
        echo systemd
    elif [ -d /run/openrc ] || { command -v rc-service >/dev/null 2>&1 && [ -x /sbin/openrc-run ]; }; then
        echo openrc
    else
        echo none
    fi
}
[ "$INIT" = auto ] && INIT=$(detect_init)
case "$INIT" in systemd|openrc|none) ;; *) die "无效 --init：$INIT（auto/systemd/openrc/none）" ;; esac

SERVICE_MODE=root
if [ -n "$SERVICE_USER" ]; then
    id "$SERVICE_USER" >/dev/null 2>&1 || die "服务用户不存在：$SERVICE_USER"
    SERVICE_MODE=user
fi

stop_service() {
    if [ "$INIT" = systemd ] && command -v systemctl >/dev/null 2>&1; then
        systemctl stop splayer-atom-core >/dev/null 2>&1 || true
    elif [ "$INIT" = openrc ] && command -v rc-service >/dev/null 2>&1; then
        rc-service splayer-atom-core stop >/dev/null 2>&1 || true
    fi
}

start_service() {
    [ "$INIT" = none ] && return 0
    if [ "$INIT" = systemd ]; then
        systemctl daemon-reload
        systemctl enable splayer-atom-core >/dev/null 2>&1 || true
        systemctl restart splayer-atom-core
    else
        rc-update add splayer-atom-core default >/dev/null 2>&1 || true
        rc-service splayer-atom-core restart
    fi
}

install_service() {
    [ "$INIT" = none ] && { info "未安装服务；手工启动：$PREFIX/bin/splayer-atom-core"; return 0; }
    cd "$PREFIX/service"
    if [ "$INIT" = systemd ]; then
        if [ "$SERVICE_MODE" = user ]; then
            ./install-systemd.sh --user "$SERVICE_USER"
        else
            ./install-systemd.sh --diretta
        fi
    else
        if [ "$SERVICE_MODE" = user ]; then
            ./install-openrc.sh --user "$SERVICE_USER"
        else
            ./install-openrc.sh --diretta
        fi
    fi
    start_service
}

uninstall() {
    stop_service
    if [ "$INIT" = systemd ]; then
        systemctl disable splayer-atom-core >/dev/null 2>&1 || true
        rm -f /etc/systemd/system/splayer-atom-core.service
        systemctl daemon-reload >/dev/null 2>&1 || true
    elif [ "$INIT" = openrc ]; then
        rc-update del splayer-atom-core default >/dev/null 2>&1 || true
        rm -f /etc/init.d/splayer-atom-core /etc/conf.d/splayer-atom-core
    fi
    if [ "$PURGE" = 1 ]; then
        rm -rf "$PREFIX"
        info "已卸载并删除 $PREFIX"
    else
        for item in app renderer node_modules runtime bin service docs variants native runtime.json install.sh PACKAGE_ARCH MULTIARCH.txt; do
            rm -rf "$PREFIX/$item"
        done
        info "已卸载程序文件，保留 $PREFIX/data"
    fi
}

rollback() {
    latest=$(find "$PREFIX" -maxdepth 1 -type d -name '.backup-*' 2>/dev/null | sort | tail -1)
    [ -n "$latest" ] || die "没有可回滚的备份"
    stop_service
    for item in app renderer node_modules runtime bin service docs variants native runtime.json install.sh; do
        rm -rf "$PREFIX/$item"
    done
    cp -a "$latest"/. "$PREFIX"/
    rm -rf "$latest"
    install_service
    info "已从 $latest 回滚"
}

if [ "$ACTION" = uninstall ]; then uninstall; exit 0; fi
if [ "$ACTION" = rollback ]; then rollback; exit 0; fi

stop_service
BACKUP=""
if [ -d "$PREFIX/app" ]; then
    BACKUP="$PREFIX/.backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP"
    info "备份现有安装到 $BACKUP"
    for item in app renderer node_modules runtime bin service docs variants native runtime.json install.sh PACKAGE_ARCH MULTIARCH.txt; do
        [ -e "$PREFIX/$item" ] && cp -a "$PREFIX/$item" "$BACKUP"/
    done
fi

mkdir -p "$PREFIX/data"
# 保留 data/；只替换程序面。
for item in app renderer node_modules runtime bin service docs variants native runtime.json; do
    rm -rf "$PREFIX/$item"
done
for item in app renderer node_modules runtime bin service docs variants LICENSE MULTIARCH.txt; do
    [ -e "$ROOT/$item" ] && cp -a "$ROOT/$item" "$PREFIX/"
done
cp "$ROOT/PACKAGE_ARCH" "$PREFIX/PACKAGE_ARCH"
cp "$ROOT/install.sh" "$PREFIX/install.sh"
chmod 0755 "$PREFIX/install.sh"
cp -a "$VARIANT_DIRS/$CPU/native" "$PREFIX/native"
cp "$VARIANT_DIRS/$CPU/runtime.json" "$PREFIX/runtime.json"

install_service
info "安装完成：$PREFIX"
info "架构：$PKG_ARCH；变体：$CPU；服务模式：$INIT/$SERVICE_MODE"
info "Web Control：http://<本机IP>:14558"
