#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SDK_ROOT=${DIRETTA_SDK_ROOT:-/home/bnqzzdf/code/DirettaHostSDK_150}
CPU_VARIANT=${DIRETTA_CPU_VARIANT:-v3}

if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
  echo "[Diretta] 需要可用的 Node.js 和 pnpm" >&2
  exit 1
fi

if [ "$(node -p 'process.versions.node')" != "24.18.0" ]; then
  echo "[Diretta] 要求使用 Node.js 24.18.0，当前为 $(node --version)" >&2
  exit 1
fi

if [ ! -d "$SDK_ROOT/Host" ] || [ ! -d "$SDK_ROOT/lib" ]; then
  echo "[Diretta] SDK 路径无效: $SDK_ROOT" >&2
  exit 1
fi

cd "$ROOT_DIR"
echo "[Diretta] 本机构建 Diretta ${CPU_VARIANT} bundled artifact"
DIRETTA_SDK_ROOT="$SDK_ROOT" \
DIRETTA_CPU_VARIANT="$CPU_VARIANT" \
pnpm exec tsx scripts/atom/build-core-system.ts \
  --require-diretta \
  --diretta-variant="$CPU_VARIANT" \
  --bundle-node
