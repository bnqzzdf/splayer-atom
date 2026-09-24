#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
IMAGE_NAME=${ATOM_DEBIAN11_IMAGE:-splayer-atom-debian11-builder}
CONTAINER_NAME=${ATOM_DEBIAN11_CONTAINER:-splayer-atom-debian11-build}
NODE_VOLUME=${ATOM_DEBIAN11_NODE_VOLUME:-splayer-atom-debian11-node-modules}
PNPM_VOLUME=${ATOM_DEBIAN11_PNPM_VOLUME:-splayer-atom-debian11-pnpm-store}
CARGO_REGISTRY_VOLUME=${ATOM_DEBIAN11_CARGO_REGISTRY_VOLUME:-splayer-atom-debian11-cargo-registry}
CARGO_GIT_VOLUME=${ATOM_DEBIAN11_CARGO_GIT_VOLUME:-splayer-atom-debian11-cargo-git}
CARGO_HTTP_TIMEOUT=${CARGO_HTTP_TIMEOUT:-600}
CARGO_HTTP_LOW_SPEED_LIMIT=${CARGO_HTTP_LOW_SPEED_LIMIT:-1}
CARGO_NET_RETRY=${CARGO_NET_RETRY:-10}
DOCKER_BIN=${DOCKER_BIN:-docker}
DIRETTA_MODE=without
DIRETTA_MODE_SET=false
DIRETTA_VARIANT=${DIRETTA_CPU_VARIANT:-}
DIRETTA_VARIANT_SET=false

for arg in "$@"; do
  case "$arg" in
    --with-diretta)
      if [ "$DIRETTA_MODE_SET" = true ] && [ "$DIRETTA_MODE" != with ]; then
        echo "[Debian11] 不能同时选择包含和不包含 Diretta" >&2
        exit 2
      fi
      DIRETTA_MODE=with
      DIRETTA_MODE_SET=true
      ;;
    --without-diretta)
      if [ "$DIRETTA_MODE_SET" = true ] && [ "$DIRETTA_MODE" != without ]; then
        echo "[Debian11] 不能同时选择包含和不包含 Diretta" >&2
        exit 2
      fi
      DIRETTA_MODE=without
      DIRETTA_MODE_SET=true
      ;;
    --diretta-variant=*)
      DIRETTA_VARIANT=${arg#--diretta-variant=}
      DIRETTA_VARIANT_SET=true
      ;;
    --help)
      echo "用法: pnpm package:core:debian11 [--without-diretta | --with-diretta --diretta-variant=v2|v3|v4]"
      echo "包含 Diretta 时还需设置 DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK"
      exit 0
      ;;
    *)
      echo "[Debian11] 未知参数: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$DIRETTA_MODE" = with ]; then
  case "$DIRETTA_VARIANT" in
    v2|v3|v4) ;;
    *) echo "[Debian11] 包含 Diretta 时必须指定 --diretta-variant=v2|v3|v4" >&2; exit 2 ;;
  esac
  if [ -z "${DIRETTA_SDK_ROOT:-}" ] || [ ! -d "$DIRETTA_SDK_ROOT/Host" ] || [ ! -d "$DIRETTA_SDK_ROOT/lib" ]; then
    echo "[Debian11] DIRETTA_SDK_ROOT 必须指向包含 Host/ 和 lib/ 的 SDK 目录" >&2
    exit 2
  fi
  SDK_ROOT=$(CDPATH= cd -- "$DIRETTA_SDK_ROOT" && pwd -P)
elif [ "$DIRETTA_VARIANT_SET" = true ]; then
  echo "[Debian11] --diretta-variant 仅能与 --with-diretta 一起使用" >&2
  exit 2
fi

if [ "$(id -u)" -eq 0 ]; then
  DOCKER="$DOCKER_BIN"
elif command -v sudo >/dev/null 2>&1; then
  DOCKER="sudo $DOCKER_BIN"
else
  DOCKER="$DOCKER_BIN"
fi

run_docker() {
  # shellcheck disable=SC2086
  $DOCKER "$@"
}

if ! run_docker info >/dev/null 2>&1; then
  echo "[Debian11] Docker 不可用，请确认 Docker daemon 和当前用户权限" >&2
  exit 1
fi

echo "[Debian11] 构建镜像: ${IMAGE_NAME}"
run_docker build \
  --file "$ROOT_DIR/docker/atom-debian11/Dockerfile" \
  --tag "$IMAGE_NAME" \
  "$ROOT_DIR/docker/atom-debian11"

run_docker volume inspect "$NODE_VOLUME" >/dev/null 2>&1 || run_docker volume create "$NODE_VOLUME" >/dev/null
run_docker volume inspect "$PNPM_VOLUME" >/dev/null 2>&1 || run_docker volume create "$PNPM_VOLUME" >/dev/null
run_docker volume inspect "$CARGO_REGISTRY_VOLUME" >/dev/null 2>&1 \
  || run_docker volume create "$CARGO_REGISTRY_VOLUME" >/dev/null
run_docker volume inspect "$CARGO_GIT_VOLUME" >/dev/null 2>&1 \
  || run_docker volume create "$CARGO_GIT_VOLUME" >/dev/null
run_docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "[Debian11] 在隔离 node_modules 和 pnpm store 的容器内打包（Diretta: $DIRETTA_MODE）"
set -- --volume "$ROOT_DIR:/src"
if [ -f "$ROOT_DIR/.git" ]; then
  GIT_COMMON_DIR=$(git -C "$ROOT_DIR" rev-parse --path-format=absolute --git-common-dir)
  set -- "$@" --volume "$ROOT_DIR:$ROOT_DIR" --volume "$GIT_COMMON_DIR:$GIT_COMMON_DIR:ro" \
    --env GIT_OPTIONAL_LOCKS=0
fi
if [ "$DIRETTA_MODE" = with ]; then
  set -- "$@" --volume "$SDK_ROOT:/opt/diretta-sdk:ro" \
    --env DIRETTA_SDK_ROOT=/opt/diretta-sdk \
    --env "DIRETTA_CPU_VARIANT=$DIRETTA_VARIANT"
fi
run_docker run --rm \
  --name "$CONTAINER_NAME" \
  "$@" \
  --volume "$NODE_VOLUME:/src/node_modules" \
  --volume "$PNPM_VOLUME:/root/.local/share/pnpm/store" \
  --volume "$CARGO_REGISTRY_VOLUME:/root/.cargo/registry" \
  --volume "$CARGO_GIT_VOLUME:/root/.cargo/git" \
  --env "CARGO_HOME=/root/.cargo" \
  --env "CARGO_HTTP_TIMEOUT=$CARGO_HTTP_TIMEOUT" \
  --env "CARGO_HTTP_LOW_SPEED_LIMIT=$CARGO_HTTP_LOW_SPEED_LIMIT" \
  --env "CARGO_NET_RETRY=$CARGO_NET_RETRY" \
  --env "ATOM_DEBIAN11_DIRETTA_MODE=$DIRETTA_MODE" \
  --workdir /src \
  "$IMAGE_NAME" \
  sh -eu -c '
    git config --global --add safe.directory /src
    pnpm install --frozen-lockfile --store-dir /root/.local/share/pnpm/store

    sqlite_dir=$(dirname "$(node -p "require.resolve(\"better-sqlite3/package.json\")")")
    npm --prefix "$sqlite_dir" run build-release
    cp "$sqlite_dir/build/Release/better_sqlite3.node" "$sqlite_dir/prebuilds/linux-x64.node"

    if [ "$ATOM_DEBIAN11_DIRETTA_MODE" = with ]; then
      pnpm exec tsx scripts/atom/build-core-system.ts \
        --require-diretta "--diretta-variant=$DIRETTA_CPU_VARIANT" --bundle-node
    else
      pnpm package:core:bundled
    fi

    check_glibc() {
      module=$1
      max_glibc=$(readelf --version-info "$module" \
        | grep -oE "GLIBC_[0-9]+(\\.[0-9]+)+" \
        | sort -V | tail -1)
      case "$max_glibc" in
        GLIBC_2.[0-2][0-9]|GLIBC_2.3[01]) : ;;
        *) echo "[Debian11] 拒绝超过 glibc 2.31 的模块: $module ($max_glibc)" >&2; exit 1 ;;
      esac
      echo "[Debian11] $module 最高需求: $max_glibc"
    }
    check_glibc out/core-system/native/audio-engine.node
    check_glibc out/core-system/native/streaming-api.node
    check_glibc out/core-system/node_modules/better-sqlite3/prebuilds/linux-x64.node

    node -e '\''const runtime = require("./out/core-system/runtime.json"); const withDiretta = process.env.ATOM_DEBIAN11_DIRETTA_MODE === "with"; if (runtime.capabilities.diretta !== withDiretta || runtime.diretta !== withDiretta || (withDiretta && runtime.direttaCpuVariant !== process.env.DIRETTA_CPU_VARIANT)) throw new Error("Diretta 产物能力位与构建模式不一致")'\''
    if [ "$ATOM_DEBIAN11_DIRETTA_MODE" = with ] && \
      readelf --dyn-syms --wide out/core-system/native/audio-engine.node \
      | grep -Eq "UND[[:space:]]+__isoc23_strtol(l)?(@|$)"; then
      echo "[Debian11] Diretta addon 仍引用 Debian 11 缺失的 __isoc23_strtol 符号" >&2
      exit 1
    fi

    # 产物名带打包时刻（YYYYMMDD-HHMMSS），无法从 runtime.json 重建，直接取 out/ 下最新的那个
    archive=$(ls -t out/splayer-atom-core-*-bundled-linux-x64.tar.gz 2>/dev/null | head -1)
    test -f "$archive"
    flavor=$ATOM_DEBIAN11_DIRETTA_MODE-diretta
    if [ "$ATOM_DEBIAN11_DIRETTA_MODE" = with ]; then
      flavor=$flavor-$DIRETTA_CPU_VARIANT
    fi
    debian_archive=${archive%.tar.gz}-debian11-$flavor.tar.gz
    cp "$archive" "$debian_archive"
    sha256sum "$debian_archive"
    echo "[Debian11] PASS $debian_archive"
  '
