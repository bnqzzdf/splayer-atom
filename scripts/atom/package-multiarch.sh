#!/bin/sh
# 把共享 app/renderer/node_modules 与多组 native addon 打成两个架构包。
#
# x86_64：variants/v1 .. v4/zen4（v1 为 ALSA-only）
# aarch64：variants/arm64
#
# 用法：
#   package-multiarch.sh --arch x86_64 \
#     --base out/splayer-atom-core-...-linux-x64.tar.gz \
#     --native-root out/native --out out
#
#   package-multiarch.sh --arch aarch64 \
#     --base out/splayer-atom-core-...-linux-x64.tar.gz \
#     --native-root /path/to/arm-native-root --out out \
#     --arm-node /path/to/node-v24.22.2-linux-arm64/bin/node \
#     --arm-sqlite /path/to/prebuilds/linux-arm64.node
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
BASE=""
NATIVE_ROOT=""
OUT_DIR=""
ARCH=""
ARM_NODE=""
ARM_SQLITE=""
INSTALL_SCRIPT="$ROOT_DIR/scripts/atom/core-system/install-multiarch.sh"

die() { echo "[MultiArchPackage] $*" >&2; exit 1; }
usage() {
    sed -n '2,/^set -eu/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --arch) ARCH=${2:-}; shift ;;
        --arch=*) ARCH=${1#*=} ;;
        --base) BASE=${2:-}; shift ;;
        --base=*) BASE=${1#*=} ;;
        --native-root) NATIVE_ROOT=${2:-}; shift ;;
        --native-root=*) NATIVE_ROOT=${1#*=} ;;
        --out) OUT_DIR=${2:-}; shift ;;
        --out=*) OUT_DIR=${1#*=} ;;
        --arm-node) ARM_NODE=${2:-}; shift ;;
        --arm-node=*) ARM_NODE=${1#*=} ;;
        --arm-sqlite) ARM_SQLITE=${2:-}; shift ;;
        --arm-sqlite=*) ARM_SQLITE=${1#*=} ;;
        --install-script) INSTALL_SCRIPT=${2:-}; shift ;;
        --install-script=*) INSTALL_SCRIPT=${1#*=} ;;
        -h|--help) usage; exit 0 ;;
        *) die "未知参数：$1" ;;
    esac
    shift
done

case "$ARCH" in
    x86_64|x64) ARCH=x86_64 ;;
    aarch64|arm64) ARCH=aarch64 ;;
    *) die "--arch 必须为 x86_64 或 aarch64" ;;
esac
[ -f "$BASE" ] || die "--base 产物不存在: $BASE"
if [ -f "$BASE.sha256" ]; then
    base_dir=$(dirname "$BASE")
    base_name=$(basename "$BASE")
    (cd "$base_dir" && sha256sum -c "$base_name.sha256") >/dev/null \
        || die "base 产物 SHA256 校验失败: $BASE"
fi
[ -d "$NATIVE_ROOT" ] || die "--native-root 不存在: $NATIVE_ROOT"
[ -f "$INSTALL_SCRIPT" ] || die "安装脚本不存在: $INSTALL_SCRIPT"
command -v python3 >/dev/null 2>&1 || die "需要 python3"
command -v tar >/dev/null 2>&1 || die "需要 tar"

if [ "$ARCH" = aarch64 ]; then
    [ -n "$ARM_NODE" ] && [ -x "$ARM_NODE" ] || die "aarch64 包需要可执行的 --arm-node"
    [ -n "$ARM_SQLITE" ] && [ -f "$ARM_SQLITE" ] || die "aarch64 包需要 --arm-sqlite prebuild"
    NATIVE_VARIANTS="arm64"
else
    NATIVE_VARIANTS="v1 v2 v3 v4 zen4"
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/atom-multiarch.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
PKG_ROOT="$WORK/pkg"
mkdir -p "$PKG_ROOT"
tar -xzf "$BASE" -C "$PKG_ROOT"

[ -f "$PKG_ROOT/runtime.json" ] || die "base 产物缺少 runtime.json"
cp "$PKG_ROOT/runtime.json" "$WORK/base-runtime.json"
VERSION=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["atomVersion"])' "$PKG_ROOT/runtime.json")
COMMIT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["atomCommit"])' "$PKG_ROOT/runtime.json")
BUILD_DATE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["buildDate"].replace("-",""))' "$PKG_ROOT/runtime.json")
COMMIT8=$(printf "%.8s" "$COMMIT")
[ -n "$VERSION" ] && [ -n "$COMMIT8" ] && [ -n "$BUILD_DATE" ] || die "base runtime.json 身份字段不完整"

rm -rf "$PKG_ROOT/native" "$PKG_ROOT/runtime.json" "$PKG_ROOT/variants"
mkdir -p "$PKG_ROOT/variants"

if [ "$ARCH" = aarch64 ]; then
    ARM_NODE_LICENSE=$(CDPATH= cd -- "$(dirname -- "$ARM_NODE")/.." && pwd)/LICENSE
    [ -f "$ARM_NODE_LICENSE" ] || die "找不到 arm64 Node LICENSE: $ARM_NODE_LICENSE"
    mkdir -p "$PKG_ROOT/runtime/bin"
    cp "$ARM_NODE" "$PKG_ROOT/runtime/bin/node"
    chmod 0755 "$PKG_ROOT/runtime/bin/node"
    cp "$ARM_NODE_LICENSE" "$PKG_ROOT/runtime/LICENSE"
    rm -f "$PKG_ROOT/node_modules/better-sqlite3/prebuilds/linux-x64.node"
    cp "$ARM_SQLITE" "$PKG_ROOT/node_modules/better-sqlite3/prebuilds/linux-arm64.node"
fi

MANIFEST="$PKG_ROOT/variants/manifest.txt"
{
    echo "package_arch=$ARCH"
    echo "atom_version=$VERSION"
    echo "atom_commit=$COMMIT"
    echo "build_date=$BUILD_DATE"
    echo "variants=$NATIVE_VARIANTS"
} > "$MANIFEST"

for variant in $NATIVE_VARIANTS; do
    src="$NATIVE_ROOT/$variant"
    [ -f "$src/audio-engine.node" ] || die "缺少 $variant/audio-engine.node"
    [ -f "$src/streaming-api.node" ] || die "缺少 $variant/streaming-api.node"
    [ -f "$src/build.json" ] || die "缺少 $variant/build.json"
    python3 - "$src/build.json" "$ARCH" "$variant" <<'PY' || die "$variant/build.json 与包架构/变体不一致"
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
    mkdir -p "$PKG_ROOT/variants/$variant/native"
    cp "$src/audio-engine.node" "$src/streaming-api.node" "$src/build.json" \
        "$PKG_ROOT/variants/$variant/native/"
    case "$variant" in
        v1) diretta=0; sdk=- ;;
        arm64) diretta=1; sdk=148 ;;
        *) diretta=1; sdk=148 ;;
    esac
    python3 - "$WORK/base-runtime.json" "$PKG_ROOT/variants/$variant/runtime.json" \
        "$ARCH" "$variant" "$diretta" "$sdk" <<'PY'
import json
import sys

src, dst, arch, variant, diretta, sdk = sys.argv[1:]
with open(src, encoding="utf-8") as handle:
    runtime = json.load(handle)
is_arm = arch == "aarch64"
runtime["arch"] = "arm64" if is_arm else "x64"
runtime["diretta"] = diretta == "1"
runtime["direttaSdkRelease"] = int(sdk) if diretta == "1" else None
runtime["direttaCpuVariant"] = variant if diretta == "1" else None
runtime["capabilities"]["diretta"] = diretta == "1"
runtime["nodeBundled"] = True
runtime["bunBundled"] = False
with open(dst, "w", encoding="utf-8") as handle:
    json.dump(runtime, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
    echo "variant=$variant diretta=$diretta sdk=$sdk" >> "$MANIFEST"
done

echo "$ARCH" > "$PKG_ROOT/PACKAGE_ARCH"
cp "$INSTALL_SCRIPT" "$PKG_ROOT/install.sh"
chmod 0755 "$PKG_ROOT/install.sh"
cat > "$PKG_ROOT/MULTIARCH.txt" <<EOF
SPlayer Atom Core multi-architecture package
arch: $ARCH
variants: $NATIVE_VARIANTS
install: ./install.sh --cpu auto --prefix /opt/splayer-atom-core
EOF

# 包内自校验；C locale 防止 sha256sum 本地化导致 grep 失效。
export LC_ALL=C LANG=C
(
    cd "$PKG_ROOT"
    find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
    sha256sum -c SHA256SUMS >/dev/null
)

mkdir -p "$OUT_DIR"
TOP="splayer-atom-core-${VERSION}-${COMMIT8}-${BUILD_DATE}-linux-${ARCH}-multi"
PKG_PATH="$OUT_DIR/$TOP.tar.gz"
rm -f "$PKG_PATH"
mv "$PKG_ROOT" "$WORK/$TOP"
tar --sort=name --mtime="@$(date -d "$BUILD_DATE" +%s 2>/dev/null || echo 0)" \
    --owner=0 --group=0 --numeric-owner \
    -czf "$PKG_PATH" -C "$WORK" "$TOP"
(cd "$OUT_DIR" && sha256sum "$TOP.tar.gz" > "$TOP.tar.gz.sha256")
echo "[MultiArchPackage] PASS $PKG_PATH"
cat "$PKG_PATH.sha256"
