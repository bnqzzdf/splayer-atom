#!/bin/sh
# 多架构发布包闸门：包名/架构/变体/ELF/Node/sqlite/runtime.json/SHA256SUMS 自洽。
set -eu
export LC_ALL=C LANG=C

die() { echo "[MultiArchCheck] FAIL: $*" >&2; exit 1; }
ok() { echo "[MultiArchCheck] PASS: $*"; }

[ $# -eq 1 ] || { echo "用法: check-multiarch-package.sh <package.tar.gz>" >&2; exit 2; }
PKG=$1
[ -f "$PKG" ] || die "包不存在: $PKG"
PKG_NAME=${PKG##*/}
[ -f "$PKG.sha256" ] || die "缺少外部 .sha256: $PKG.sha256"
(cd "$(dirname "$PKG")" && sha256sum -c "$(basename "$PKG").sha256") >/dev/null || die "外部 SHA256 校验失败"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/atom-multiarch-check.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
tar -xzf "$PKG" -C "$WORK"
TOP=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -n "$TOP" ] || die "包为空"
[ "$(find "$WORK" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ] || die "包内顶层必须只有一个目录"
[ -f "$TOP/PACKAGE_ARCH" ] || die "缺少 PACKAGE_ARCH"
ARCH=$(cat "$TOP/PACKAGE_ARCH")
case "$ARCH" in x86_64|aarch64) ;; *) die "PACKAGE_ARCH 非法: $ARCH" ;; esac
case "$ARCH" in
    x86_64) EXPECT_ELF="x86-64"; EXPECT_NODE="x86-64"; EXPECT_VARIANTS="v1 v2 v3 v4 zen4" ;;
    aarch64) EXPECT_ELF="ARM aarch64"; EXPECT_NODE="ARM aarch64"; EXPECT_VARIANTS="arm64" ;;
esac
case "$PKG_NAME" in
    *-linux-"$ARCH"-multi.tar.gz) ;;
    *) die "包名缺少 -linux-$ARCH-multi.tar.gz: $PKG_NAME" ;;
esac

[ -f "$TOP/variants/manifest.txt" ] || die "缺少 variants/manifest.txt"
VARIANT_LINE=$(sed -n 's/^variants=//p' "$TOP/variants/manifest.txt" | head -1)
[ "$VARIANT_LINE" = "$EXPECT_VARIANTS" ] || die "变体列表不符: $VARIANT_LINE != $EXPECT_VARIANTS"
ok "包名/架构/变体列表：$ARCH / $VARIANT_LINE"

[ -f "$TOP/install.sh" ] || die "缺少 install.sh"
sh -n "$TOP/install.sh" || die "install.sh 语法错误"
[ -x "$TOP/install.sh" ] || die "install.sh 不可执行"
grep -q "audiosys" "$TOP/install.sh" || die "install.sh 缺少 audiosys 支持"
for helper in splayeratomctl.sh splayeratom-menu.sh install-audiosys.sh; do
    [ -f "$TOP/service/$helper" ] || die "缺少 AudioSys helper: service/$helper"
    [ -x "$TOP/service/$helper" ] || die "AudioSys helper 不可执行: service/$helper"
    sh -n "$TOP/service/$helper" || die "AudioSys helper 语法错误: service/$helper"
done
ok "install.sh 与 AudioSys helper 语法/权限"

[ -f "$TOP/runtime/bin/node" ] || die "缺少 bundled Node"
file "$TOP/runtime/bin/node" | grep -q "$EXPECT_NODE" || die "bundled Node 架构不符"
file "$TOP/node_modules/better-sqlite3/prebuilds/linux-$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64).node" \
    | grep -q "$EXPECT_ELF" || die "better-sqlite3 prebuild 架构不符"
ok "Node 与 better-sqlite3 架构"

for variant in $EXPECT_VARIANTS; do
    [ -d "$TOP/variants/$variant/native" ] || die "缺少变体目录: $variant"
    for addon in audio-engine.node streaming-api.node; do
        file "$TOP/variants/$variant/native/$addon" | grep -q "$EXPECT_ELF" \
            || die "$variant/$addon 架构不符"
    done
    python3 - "$TOP/variants/$variant/runtime.json" "$ARCH" "$variant" <<'PY' || exit 1
import json
import sys

path, arch, variant = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    runtime = json.load(handle)
expect_arch = "arm64" if arch == "aarch64" else "x64"
expect_diretta = variant != "v1"
assert runtime["arch"] == expect_arch, (path, runtime["arch"], expect_arch)
assert runtime["diretta"] is expect_diretta, (path, runtime["diretta"], expect_diretta)
assert runtime["capabilities"]["diretta"] is expect_diretta
assert runtime["direttaCpuVariant"] == (None if not expect_diretta else variant)
assert runtime["nodeBundled"] is True
PY
    python3 - "$TOP/variants/$variant/native/build.json" "$ARCH" "$variant" <<'PY' || exit 1
import json
import sys

path, arch, variant = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    build = json.load(handle)
expect_arch = "arm64" if arch == "aarch64" else "x64"
expect_diretta = variant != "v1"
assert build["platform"] == "linux", path
assert build["arch"] == expect_arch, (path, build["arch"], expect_arch)
assert build["diretta"] is expect_diretta, (path, build["diretta"], expect_diretta)
if expect_diretta:
    assert build["direttaCpuVariant"] == variant, path
    assert build["direttaSdkRelease"] == 148, path
else:
    assert build["direttaCpuVariant"] is None, path
    assert build["direttaSdkRelease"] is None, path
PY
    ok "variant $variant ELF + runtime.json + build.json"
done

if [ -n "$(find "$TOP" -type l -print -quit)" ]; then
    die "包内不允许符号链接（用真实文件）"
fi
(
    cd "$TOP"
    sha256sum -c SHA256SUMS >/dev/null
) || die "包内 SHA256SUMS 校验失败"
ok "包内 SHA256SUMS"

echo "[MultiArchCheck] PASS $PKG_NAME"
