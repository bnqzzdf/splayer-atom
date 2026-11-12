#!/bin/sh
# 在 aarch64 Linux 构建机上原生编译 arm64 Core native addons。
# 用法：DIRETTA_SDK_ROOT=/root/DirettaHostSDK_148 sh scripts/atom/build-arm64-native.sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
OUT_DIR=${ATOM_ARM64_NATIVE_DIR:-"$ROOT_DIR/out/native/arm64"}
TARGET_DIR=${CARGO_TARGET_DIR:-"$ROOT_DIR/target/arm64-native"}
SDK_ROOT=${DIRETTA_SDK_ROOT:-/root/DirettaHostSDK_148}
PATH="/root/.cargo/bin:$PATH"
export PATH
export CARGO_TARGET_DIR="$TARGET_DIR"
export CARGO_NET_RETRY=${CARGO_NET_RETRY:-10}
export CARGO_HTTP_TIMEOUT=${CARGO_HTTP_TIMEOUT:-600}
export DIRETTA_CPU_VARIANT=arm64

die() { echo "[Arm64Native] $*" >&2; exit 1; }

[ "$(uname -m)" = "aarch64" ] || die "必须在 aarch64 构建机上运行（当前 $(uname -m)）"
command -v cargo >/dev/null 2>&1 || die "找不到 cargo"
[ -f "$SDK_ROOT/Host/Release.hpp" ] || die "DIRETTA_SDK_ROOT 缺少 Host/Release.hpp: $SDK_ROOT"
[ -d "$SDK_ROOT/lib" ] || die "DIRETTA_SDK_ROOT 缺少 lib/: $SDK_ROOT"
SDK_RELEASE=$(sed -n 's/.*ReleaseNo[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SDK_ROOT/Host/Release.hpp" | head -1)
[ "$SDK_RELEASE" = "148" ] || die "arm64 Core 需要 Diretta SDK 148，当前为 ${SDK_RELEASE:-unknown}"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "[Arm64Native] build audio-engine (ALSA + Diretta arm64)"
cargo build --locked --release -p audio-engine --no-default-features --features core-audio,diretta
echo "[Arm64Native] build streaming-api"
cargo build --locked --release -p streaming-api

cp "$TARGET_DIR/release/libaudio_engine.so" "$OUT_DIR/audio-engine.node"
cp "$TARGET_DIR/release/libstreaming_api.so" "$OUT_DIR/streaming-api.node"
chmod 0644 "$OUT_DIR/audio-engine.node" "$OUT_DIR/streaming-api.node"

python3 - "$OUT_DIR/build.json" "$SDK_RELEASE" <<'PY'
import json
import sys

path, sdk_release = sys.argv[1], int(sys.argv[2])
with open(path, "w", encoding="utf-8") as handle:
    json.dump(
        {
            "profile": "release",
            "flavor": "core-audio",
            "modules": ["audio-engine", "streaming-api"],
            "platform": "linux",
            "arch": "arm64",
            "diretta": True,
            "direttaSdkRelease": sdk_release,
            "direttaCpuVariant": "arm64",
        },
        handle,
        ensure_ascii=False,
        indent=2,
    )
    handle.write("\n")
PY

for addon in "$OUT_DIR/audio-engine.node" "$OUT_DIR/streaming-api.node"; do
    file "$addon" | grep -q "ARM aarch64" || die "不是 aarch64 ELF: $addon"
done
if ldd "$OUT_DIR/audio-engine.node" 2>&1 | grep -Eiq 'lib(pipewire|pulse)'; then
    die "audio-engine 仍携带 PipeWire/PulseAudio 动态依赖"
fi
if ldd "$OUT_DIR/streaming-api.node" 2>&1 | grep -Eiq 'lib(ssl|crypto)\.so'; then
    die "streaming-api 仍携带 OpenSSL 动态依赖"
fi

echo "[Arm64Native] PASS $OUT_DIR"
