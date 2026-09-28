# Diretta CPU 变体（v2 / v3 / v4 / zen4）

> 最后更新：2026-09-28

播放引擎 `audio-engine.node` 静态链接 Diretta Host SDK 的预编译库。SDK 按
`-march=x86-64-vN` 分别发布这些库，**变体不是优化等级，而是「能不能在这台机器上跑」**。

## 为什么必须可选

实测：在一台 Intel Celeron J1900（Silvermont，**完全没有 AVX**，最高只到 x86-64-v2）上，
用 v3 变体构建的产物会在播放引擎第一次真正干活时崩溃：

```
traps: tokio-rt-worker[6962] trap invalid opcode ip:... in audio-engine.node[9078e7,...]
```

dmesg 报的偏移换算成虚拟地址后，反汇编到出错的那条指令是：

```
9088e7:	c5 f9 ef c0          	vpxor  %xmm0,%xmm0,%xmm0     ← AVX（VEX 编码）
```

`invalid opcode`（SIGILL）而不是段错误，正是「执行了这台 CPU 不认识的指令」的特征。
Core 本身能启动、能加载 addon，是因为只有真正走进音频路径才会碰到这些指令；
一旦碰到，整个 Core 进程被信号打死（OpenRC `supervise-daemon` 会把它拉起来，
所以表现成「接口请求返回 000、进程看起来还活着」）。

## SDK 150 实际发布哪些变体（实测）

`objdump -d` 统计 AVX 类指令（`%ymm`/`%zmm`/`vpxor`/`vfmadd`/`vmovdqu`/`vpaddd`/`vperm`）：

| 归档                                    | 大小    | AVX 类指令 |
| --------------------------------------- | ------- | ---------- |
| `libACQUA_x64-linux-15v2-nolog.a`       | 335,892 | **0**      |
| `libDirettaHost_x64-linux-15v2-nolog.a` | 377,288 | **0**      |
| `libACQUA_x64-linux-15v3-nolog.a`       | 337,244 | 623        |
| `libDirettaHost_x64-linux-15v3-nolog.a` | 379,024 | 466        |

SDK 150 还发布了 `v4` 与 `zen4`（`lib*_x64-linux-15v4-nolog.a`、`lib*_x64-linux-15zen4-nolog.a`）。

### **没有 v1**

SDK 150 的 `lib/` 下不存在任何 `v1` 归档，所以**带 Diretta 的 v1 产物不可能存在**。
需要 v1（纯 x86-64 基线）只能做**不带 Diretta 的 ALSA-only 构建**。

是否链接 SDK 不由 `--require-diretta` 决定，而由 **`DIRETTA_SDK_ROOT` 是否存在**决定
（`scripts/atom/build-core-native.ts:35,43-50,90`）：只有它存在时才会带上 `diretta` feature 并读
SDK release。因此

- **不设置** `DIRETTA_SDK_ROOT` → 不带 Diretta 的 ALSA-only 构建（`pnpm package:core`），不链接 SDK；
- 保留了 `DIRETTA_SDK_ROOT`、只是想拿掉变体时**不能只摘 `DIRETTA_CPU_VARIANT`**：脚本会因
  「Diretta Core 构建要求指定 `--diretta-variant=v2|v3|v4`」直接失败
  （`scripts/atom/build-core-native.ts:48-50`）。

`--require-diretta` 的唯一作用是**缺 SDK 时报错**（`scripts/atom/build-core-native.ts:36-38`），
它本身不会让构建去链接 SDK。`docker/atom-debian11/build.sh:52-53` 也专门记下了这个坑：
不带 Diretta 的容器内构建必须确保 `DIRETTA_SDK_ROOT` 未设置。

## 变体与 CPU 代次对照

| 变体 | 需要的指令集                              | 典型 CPU                            | 产物    |
| ---- | ----------------------------------------- | ----------------------------------- | ------- |
| v2   | SSE4.2 / POPCNT / CMPXCHG16B（x86-64-v2） | Celeron J1900、Atom、二代酷睿及以后 | ✅      |
| v3   | AVX / AVX2 / BMI / FMA（x86-64-v3）       | Haswell（2013）及以后、多数现代 x86 | ✅      |
| v4   | AVX-512（x86-64-v4）                      | Skylake-X、Ice Lake 服务器          | ✅      |
| zen4 | AMD Zen 4 优化版                          | Ryzen 7000 / EPYC 9004              | ✅      |
| v1   | 纯基线                                    | 2009 年前的机器                     | ❌ 见上 |

> 选变体的原则：**取目标机器支持的最高代次**。v2 产物在 v3/v4 机器上照样能跑
> （只是用不到 AVX 优化），反过来不行。

## 怎么构建

两种等价写法：

```bash
# 通过 CLI 参数
pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --diretta-variant=v2 --bundle-node

# 或通过环境变量
DIRETTA_CPU_VARIANT=v2 pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --bundle-node
```

`build-core-native.ts` 会把变体写进 `out/native/build.json`，`stage-core-system.ts`
与 `check-core-artifact.ts` 都从**同一个文件**读回来重建产物名，因此两步不会算错名字。

## 产物名与 runtime.json

变体进文件名，否则同版本多个 tar 无法区分：

```
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>-diretta-v2-bundled-linux-x64.tar.gz
```

不带 Diretta 的构建没有这一段：

```
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz
```

`runtime.json` 与 `native/build.json` 都记录 `direttaCpuVariant`。产物自检
`scripts/atom/check-core-artifact.ts` 只做**存在性**校验——「带 Diretta 就必须有变体、
不带就必须为 `null`」（`:38,222-230`），并沿用 `build.json` 的变体重建产物名；它**不比对**
`runtime.json` 与 `native/build.json` 的变体是否一致。真正逐字比对变体的是 Debian 11
容器构建的最后一步：把 `runtime.json.direttaCpuVariant` 与本次构建的 `DIRETTA_CPU_VARIANT`
比较（`docker/atom-debian11/build.sh:95-97`）。

## 验收

构建后先确认变体真的生效（不需要目标机）：

```bash
mkdir -p /tmp/chk && cd /tmp/chk && ar x /path/to/libACQUA_x64-linux-15v2-nolog.a
objdump -d ./*.o | grep -cE '%ymm|%zmm|vpxor|vfmadd|vmovdqu'   # 期望 0
```

部署到目标机后再确认一次：

```bash
objdump -d /opt/splayer-atom-core/native/audio-engine.node \
  | grep -cE '%ymm|%zmm|vpxor|vfmadd|vmovdqu'
dmesg | grep -i "invalid opcode"     # 期望没有新记录
curl -s http://127.0.0.1:14558/api/output/devices   # 期望能列出设备
```

> 注意：直接执行 `./audio-engine.node` 会段错误，这是 **Node addon 的正常表现**
> （它是共享库、没有可执行入口），不是 CPU 不兼容的证据。真正的证据是
> dmesg 里的 `invalid opcode`。
