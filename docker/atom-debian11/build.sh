#!/bin/sh
# 在 Debian 11 容器内执行：安装依赖 → 编译 → glibc/Diretta 校验 → 产出 debian11 产物。
#
# 由 scripts/atom/build-debian11-bundled.sh 通过 docker run 调用，所需环境变量：
#   ATOM_DEBIAN11_DIRETTA_MODE  with | without
#   DIRETTA_CPU_VARIANT         with 时必填：v2 | v3 | v4 | zen4
#   DIRETTA_SDK_ROOT            with 时必填，宿主 SDK 只读挂载进来的路径
#
# 把这个脚本单独放成一个文件（而不是塞在 build-debian11-bundled.sh 的
# `sh -c '...'` 里）有两个原因：一是不用再对着嵌套引号做 `'\''` 转义，
# 二是它可以被单独 shellcheck 与单独执行。
set -eu

MODE=${ATOM_DEBIAN11_DIRETTA_MODE:-without}
VARIANT=${DIRETTA_CPU_VARIANT:-}

echo "[Debian11] $(. /etc/os-release; echo "$PRETTY_NAME")  内核glibc=$(ldd --version | head -1 | awk '{print $NF}')  Diretta=$MODE${VARIANT:+ ($VARIANT)}"

if [ "$MODE" = with ]; then
  if [ -z "${DIRETTA_SDK_ROOT:-}" ] || [ ! -d "$DIRETTA_SDK_ROOT/lib" ]; then
    echo "[Debian11] DIRETTA_SDK_ROOT 未指向有效 SDK（缺 lib/）" >&2
    exit 2
  fi
  case "$VARIANT" in
    v2|v3|v4|zen4) ;;
    *) echo "[Debian11] 包含 Diretta 时必须指定 DIRETTA_CPU_VARIANT=v2|v3|v4|zen4" >&2; exit 2 ;;
  esac
  # 变体是「能不能跑」而不是「快不快」：SDK 的预编译库按 -march=x86-64-vN 发布，
  # 目标机只支持到 v2 时用 v3 库会直接 SIGILL。这里先确认对应归档真的存在。
  for lib in "libDirettaHost_x64-linux-" "libACQUA_x64-linux-"; do
    if ! ls "$DIRETTA_SDK_ROOT"/lib/${lib}*"$VARIANT"*.a >/dev/null 2>&1; then
      echo "[Debian11] SDK 里找不到 $VARIANT 变体的 ${lib}* 归档" >&2
      ls "$DIRETTA_SDK_ROOT"/lib/ | grep -E "DirettaHost_x64|ACQUA_x64" | head -20 >&2
      exit 2
    fi
  done
fi

echo "[1/4] pnpm install"
pnpm install --frozen-lockfile --store-dir /root/.local/share/pnpm/store

echo "[2/4] 从源码编译 better-sqlite3（需匹配 Debian 11 的 glibc）"
sqlite_dir=$(dirname "$(node -p "require.resolve('better-sqlite3/package.json')")")
npm --prefix "$sqlite_dir" run build-release
cp "$sqlite_dir/build/Release/better_sqlite3.node" "$sqlite_dir/prebuilds/linux-x64.node"

echo "[3/4] 构建 Core 产物"
if [ "$MODE" = with ]; then
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta "--diretta-variant=$VARIANT" --bundle-node
else
  # 不带 Diretta 的 ALSA-only 构建：注意不能设置 DIRETTA_SDK_ROOT，
  # build-core-native.ts 只要看到它就会走 Diretta 分支并要求指定变体。
  pnpm package:core:bundled
fi

echo "[4/4] 校验"

# glibc 上限：Debian 11 = 2.31。任何原生模块超过它，这个产物就不该发出去。
check_glibc() {
  module=$1
  max_glibc=$(readelf --version-info "$module" \
    | grep -oE "GLIBC_[0-9]+(\.[0-9]+)+" \
    | sort -V | tail -1)
  echo "  glibc需求  $(printf '%-52s' "$module") = ${max_glibc:-无}"
  case "$max_glibc" in
    ''|GLIBC_2.[0-2][0-9]|GLIBC_2.3[01]) : ;;
    *) echo "[Debian11] 拒绝超过 glibc 2.31 的模块: $module ($max_glibc)" >&2; exit 1 ;;
  esac
}
check_glibc out/core-system/native/audio-engine.node
check_glibc out/core-system/native/streaming-api.node
check_glibc out/core-system/node_modules/better-sqlite3/prebuilds/linux-x64.node

# AVX 类指令计数：**只报数不做门禁**。
# 若目标机是只到 x86-64-v2 的 CPU，v3/v4 变体会在这里露出高计数；
# 但计数高不等于会崩——Rust/依赖里可能有运行时派发的 SIMD。
# 真正的验收必须在目标机上实跑（见 docs/cpu-variants.md）。
report_avx() {
  module=$1
  count=$(objdump -d "$module" 2>/dev/null \
    | grep -cE "%ymm|%zmm|vpxor|vfmadd|vmovdqu|vpaddd|vperm|vbroadcast" || true)
  echo "  AVX类指令 $(printf '%-52s' "$module") = $count"
}
report_avx out/core-system/native/audio-engine.node
report_avx out/core-system/native/streaming-api.node

# runtime.json 的能力位必须与本次构建模式一致，否则产物会被误发。
node -e '
const runtime = require("./out/core-system/runtime.json");
const withDiretta = process.env.ATOM_DEBIAN11_DIRETTA_MODE === "with";
if (runtime.capabilities.diretta !== withDiretta || runtime.diretta !== withDiretta) {
  throw new Error("Diretta 产物能力位与构建模式不一致");
}
if (withDiretta && runtime.direttaCpuVariant !== process.env.DIRETTA_CPU_VARIANT) {
  throw new Error("runtime.json 记录的 CPU 变体与本次构建不一致");
}
if (!withDiretta && runtime.direttaCpuVariant != null) {
  throw new Error("不带 Diretta 的产物不应携带 CPU 变体");
}
console.log(`  runtime.json: diretta=${runtime.diretta} variant=${runtime.direttaCpuVariant ?? "-"} commit=${String(runtime.atomCommit).slice(0, 8)} dirty=${runtime.sourceDirty}`);
'

# Diretta 的 ACQUA 库引用了 glibc 2.38 才有的 C23 整数解析符号，
# 靠 native/diretta-sys/src/glibc_compat.c 的 weak 定义兜住；
# 这里确认它真的没有以「未定义符号」的形式留在 addon 里。
if [ "$MODE" = with ] && \
  readelf --dyn-syms --wide out/core-system/native/audio-engine.node \
  | grep -Eq "UND[[:space:]]+__isoc23_strtol(l)?(@|$)"; then
  echo "[Debian11] Diretta addon 仍引用 Debian 11 缺失的 __isoc23_strtol 符号" >&2
  exit 1
fi

# 产物名带打包时刻（YYYYMMDD-HHMMSS），无法从 runtime.json 重建，直接取 out/ 下最新的那个
archive=$(ls -t out/splayer-atom-core-*-bundled-linux-x64.tar.gz 2>/dev/null | head -1)
test -f "$archive"
flavor=$MODE-diretta
if [ "$MODE" = with ]; then
  flavor=$flavor-$VARIANT
fi
debian_archive=${archive%.tar.gz}-debian11-$flavor.tar.gz
cp "$archive" "$debian_archive"
sha256sum "$debian_archive"
echo "[Debian11] PASS $debian_archive"
