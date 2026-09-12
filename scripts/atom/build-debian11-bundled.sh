#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
IMAGE_NAME=${ATOM_DEBIAN11_IMAGE:-splayer-atom-debian11-builder}
CONTAINER_NAME=${ATOM_DEBIAN11_CONTAINER:-splayer-atom-debian11-build}
NODE_VOLUME=${ATOM_DEBIAN11_NODE_VOLUME:-splayer-atom-debian11-node-modules}
PNPM_VOLUME=${ATOM_DEBIAN11_PNPM_VOLUME:-splayer-atom-debian11-pnpm-store}
DOCKER_BIN=${DOCKER_BIN:-docker}

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
run_docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "[Debian11] 在隔离 node_modules 和 pnpm store 的容器内打包"
run_docker run --rm \
  --name "$CONTAINER_NAME" \
  --volume "$ROOT_DIR:/src" \
  --volume "$NODE_VOLUME:/src/node_modules" \
  --volume "$PNPM_VOLUME:/root/.local/share/pnpm/store" \
  --workdir /src \
  "$IMAGE_NAME" \
  sh -eu -c '
    git config --global --add safe.directory /src
    pnpm install --frozen-lockfile

    sqlite_dir=$(dirname "$(node -p "require.resolve(\"better-sqlite3/package.json\")")")
    npm --prefix "$sqlite_dir" run build-release
    cp "$sqlite_dir/build/Release/better_sqlite3.node" "$sqlite_dir/prebuilds/linux-x64.node"

    pnpm package:core:bundled

    max_glibc=$(readelf --version-info out/core-system/native/audio-engine.node \
      | grep -oE "GLIBC_[0-9]+(\\.[0-9]+)+" \
      | sort -V | tail -1)
    case "$max_glibc" in
      GLIBC_2.[0-2][0-9]|GLIBC_2.3[01]) : ;;
      *) echo "[Debian11] 拒绝超过 glibc 2.31 的 audio-engine: $max_glibc" >&2; exit 1 ;;
    esac

    sqlite_glibc=$(readelf --version-info out/core-system/node_modules/better-sqlite3/prebuilds/linux-x64.node \
      | grep -oE "GLIBC_[0-9]+(\\.[0-9]+)+" \
      | sort -V | tail -1)
    case "$sqlite_glibc" in
      GLIBC_2.[0-2][0-9]|GLIBC_2.3[01]) : ;;
      *) echo "[Debian11] 拒绝超过 glibc 2.31 的 better-sqlite3: $sqlite_glibc" >&2; exit 1 ;;
    esac

    archive=$(find out -maxdepth 1 -type f -name "splayer-atom-core-*-bundled-linux-x64.tar.gz" -print -quit)
    test -n "$archive"
    sha256sum "$archive"
    echo "[Debian11] PASS $archive"
  '
