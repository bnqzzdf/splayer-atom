# Debian 11 构建容器

这个目录是 `pnpm package:core:debian11` 用的打包环境。**发布产物在这里构建**，
因为它决定了产物的 glibc 下限。

| 文件         | 作用                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `Dockerfile` | 构建镜像：Debian 11 (bullseye, glibc 2.31) + build-essential/clang/llvm + Node 24.18.0 + pnpm 11.5.2 + Rust stable |
| `build.sh`   | **在容器内**跑的构建脚本：装依赖 → 编 native → 打产物 → 校验 glibc 与 Diretta 能力位                               |

宿主侧的入口是 `scripts/atom/build-debian11-bundled.sh`（`pnpm package:core:debian11`），
它负责建镜像、建缓存卷、把仓库与 SDK 挂进容器，然后执行 `build.sh`。

## 为什么用 Debian 11

产物要在「任意 glibc ≥ 2.30 的 x86-64 Linux」上跑，所以必须在一个足够老的
glibc 上链接。Debian 11 是 glibc **2.31**，正好卡住这个下限。

`build.sh` 的最后一步会逐个检查原生模块的 `GLIBC_*` 需求，超过 2.31 直接让构建失败——
宁可在这里失败，也不要把一个在目标机上加载不了的产物发出去。

Diretta SDK 150 的 ACQUA 预编译库引用了 glibc 2.38 才提供的 C23 整数解析符号
（`__isoc23_strtol` / `__isoc23_strtoll`），由 `native/diretta-sys/src/glibc_compat.c`
提供的 weak 定义兜住；构建收尾会确认这两个符号没有以「未定义」形式留在 addon 里。

## 用法

```bash
# 不带 Diretta（ALSA-only）
pnpm package:core:debian11 --without-diretta

# 带 Diretta，必须指定 CPU 变体
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

产物：

```
out/splayer-atom-core-<版本>-<提交号>-<日期>-<时刻>-debian11-without-diretta.tar.gz
out/splayer-atom-core-<版本>-<提交号>-<日期>-<时刻>[-diretta-<变体>]-debian11-with-diretta-<变体>.tar.gz
```

## CPU 变体怎么选

变体不是「优化等级」，是**能不能在这台机器上跑**。SDK 按 `-march=x86-64-vN` 分别发布
预编译库，用比目标机更高的变体会直接 SIGILL（`invalid opcode`）。

| 变体   | 需要                         | 典型 CPU                            |
| ------ | ---------------------------- | ----------------------------------- |
| `v2`   | SSE4.2 / POPCNT（x86-64-v2） | Celeron J1900、Atom、二代酷睿及以后 |
| `v3`   | AVX / AVX2 / FMA             | Haswell（2013）及以后               |
| `v4`   | AVX-512                      | Skylake-X、Ice Lake 服务器          |
| `zen4` | AMD Zen 4                    | Ryzen 7000 / EPYC 9004              |

原则：**取目标机支持的最高代次**。低变体产物在高代次机器上照样能跑，反过来不行。
（SDK 150 没有发布 v1 库，所以不存在带 Diretta 的 v1 产物；需要 v1 只能用 ALSA-only。）

详见 [`docs/cpu-variants.md`](../../docs/cpu-variants.md)。

## 网络

驱动脚本默认用 **host 网络**（`docker build --network host` 与 `docker run --network host`）：
镜像构建要联网拉 apt 包和 Node/Rust，容器内还要拉 pnpm/cargo 依赖；而 BuildKit 默认的
bridge 网络在部分宿主上不可用，Gentoo 上实测直接报 `network bridge not found`。

需要换回默认 bridge 时覆盖即可：

```bash
ATOM_DEBIAN11_NETWORK=default pnpm package:core:debian11 --without-diretta
```

## 缓存卷

驱动脚本会创建四个具名卷，避免每次重新下载依赖：

```
splayer-atom-debian11-node-modules
splayer-atom-debian11-pnpm-store
splayer-atom-debian11-cargo-registry
splayer-atom-debian11-cargo-git
```

名字都可以用环境变量覆盖（`ATOM_DEBIAN11_*`）。想彻底重来就删掉这几个卷。

## 注意

- 仓库以 bind mount 挂进容器，`out/` 会直接写在宿主的工作树上。
- 带 Diretta 时 SDK 是**只读**挂载（`/opt/diretta-sdk`），SDK 本体不会进入产物。
- `.dockerignore` 排除了 `.git` / `node_modules` / `out` / `target` / `*.tar.gz`，
  镜像里不带这些；运行时靠卷和 bind mount 提供。
