# Diretta CPU variants (v2 / v3 / v4 / zen4)

> Last updated: 2026-09-28

The playback engine `audio-engine.node` statically links the prebuilt libraries of the Diretta Host
SDK. The SDK ships these libraries separately per `-march=x86-64-vN`; **a variant is not an
optimization level, it is "can it run on this machine"**.

## Why it must be optional

Measured: on an Intel Celeron J1900 (Silvermont, **no AVX at all**, only up to x86-64-v2),
an artifact built with the v3 variant crashes the first time the playback engine really does work:

```
traps: tokio-rt-worker[6962] trap invalid opcode ip:... in audio-engine.node[9078e7,...]
```

Converting the offset reported by dmesg into a virtual address and disassembling it, the offending
instruction is:

```
9088e7:	c5 f9 ef c0          	vpxor  %xmm0,%xmm0,%xmm0     ← AVX (VEX encoding)
```

`invalid opcode` (SIGILL) rather than a segmentation fault is exactly the signature of "an instruction
this CPU does not know was executed". Core itself can start and load the addon because these
instructions are only reached when the audio path is actually entered; once they are hit, the whole
Core process is killed by the signal (OpenRC `supervise-daemon` will pull it back up, so it shows up as
"API requests return 000 while the process still looks alive").

## Which variants SDK 150 actually ships (measured)

`objdump -d` counting AVX-class instructions (`%ymm`/`%zmm`/`vpxor`/`vfmadd`/`vmovdqu`/`vpaddd`/`vperm`):

| Archive                                 | Size    | AVX-class instructions |
| --------------------------------------- | ------- | ---------------------- |
| `libACQUA_x64-linux-15v2-nolog.a`       | 335,892 | **0**                  |
| `libDirettaHost_x64-linux-15v2-nolog.a` | 377,288 | **0**                  |
| `libACQUA_x64-linux-15v3-nolog.a`       | 337,244 | 623                    |
| `libDirettaHost_x64-linux-15v3-nolog.a` | 379,024 | 466                    |

SDK 150 also ships `v4` and `zen4` (`lib*_x64-linux-15v4-nolog.a`, `lib*_x64-linux-15zen4-nolog.a`).

### **No v1**

There is no `v1` archive under SDK 150's `lib/`, so **a v1 artifact with Diretta cannot exist**.
If you need v1 (the pure x86-64 baseline), the only option is an **ALSA-only build without Diretta**.

Whether the SDK is linked is not decided by `--require-diretta` but by **whether `DIRETTA_SDK_ROOT`
exists** (`scripts/atom/build-core-native.ts:35,43-50,90`): only when it exists does the build carry the
`diretta` feature and read the SDK release. Therefore

- **not setting** `DIRETTA_SDK_ROOT` → an ALSA-only build without Diretta (`pnpm package:core`), which
  does not link the SDK;
- if `DIRETTA_SDK_ROOT` is kept and you merely want to drop the variant, you **cannot just remove
  `DIRETTA_CPU_VARIANT`**: the script fails outright because
  "a Diretta Core build requires `--diretta-variant=v2|v3|v4`"
  (`scripts/atom/build-core-native.ts:48-50`).

The only role of `--require-diretta` is to **error out when the SDK is missing**
(`scripts/atom/build-core-native.ts:36-38`); by itself it does not make the build link the SDK.
`docker/atom-debian11/build.sh:52-53` also specifically notes this pitfall: a build inside the container
without Diretta must ensure `DIRETTA_SDK_ROOT` is unset.

## Variants vs. CPU generations

| Variant | Required instruction set                 | Typical CPU                                 | Artifact     |
| ------- | ---------------------------------------- | ------------------------------------------- | ------------ |
| v2      | SSE4.2 / POPCNT / CMPXCHG16B (x86-64-v2) | Celeron J1900, Atom, 2nd-gen Core and later | ✅           |
| v3      | AVX / AVX2 / BMI / FMA (x86-64-v3)       | Haswell (2013) and later, most modern x86   | ✅           |
| v4      | AVX-512 (x86-64-v4)                      | Skylake-X, Ice Lake servers                 | ✅           |
| zen4    | AMD Zen 4 optimized                      | Ryzen 7000 / EPYC 9004                      | ✅           |
| v1      | Pure baseline                            | Machines from before 2009                   | ❌ see above |

> The principle for choosing a variant: **take the highest generation the target machine supports**.
> A v2 artifact still runs on a v3/v4 machine (it just cannot use the AVX optimizations), but not the
> other way around.

## How to build

Two equivalent forms:

```bash
# via the CLI flag
pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --diretta-variant=v2 --bundle-node

# or via the environment variable
DIRETTA_CPU_VARIANT=v2 pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --bundle-node
```

`build-core-native.ts` writes the variant into `out/native/build.json`, and both `stage-core-system.ts`
and `check-core-artifact.ts` read it back from **the same file** to rebuild the artifact name, so the
two steps cannot compute the wrong name.

## Artifact name and runtime.json

The variant goes into the filename, otherwise several tarballs of the same version cannot be told apart:

```
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>-diretta-v2-bundled-linux-x64.tar.gz
```

Builds without Diretta have no such segment:

```
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz
```

Both `runtime.json` and `native/build.json` record `direttaCpuVariant`. The artifact self-check
`scripts/atom/check-core-artifact.ts` only validates **presence** — "with Diretta there must be a
variant, without it the value must be `null`" (`:38,222-230`) — and rebuilds the artifact name from the
variant in `build.json`; it **does not compare** whether the variants in `runtime.json` and
`native/build.json` agree. What does compare the variant character by character is the last step of the
Debian 11 container build: comparing `runtime.json.direttaCpuVariant` with this build's
`DIRETTA_CPU_VARIANT`
(`docker/atom-debian11/build.sh:95-97`).

## Acceptance

After building, first confirm the variant really took effect (no target machine needed):

```bash
mkdir -p /tmp/chk && cd /tmp/chk && ar x /path/to/libACQUA_x64-linux-15v2-nolog.a
objdump -d ./*.o | grep -cE '%ymm|%zmm|vpxor|vfmadd|vmovdqu'   # expect 0
```

Confirm once more after deploying to the target machine:

```bash
objdump -d /opt/splayer-atom-core/native/audio-engine.node \
  | grep -cE '%ymm|%zmm|vpxor|vfmadd|vmovdqu'
dmesg | grep -i "invalid opcode"     # expect no new records
curl -s http://127.0.0.1:14558/api/output/devices   # expect the devices to be listed
```

> Note: running `./audio-engine.node` directly segfaults; this is **normal behavior for a Node addon**
> (it is a shared library with no executable entry point), not evidence of CPU incompatibility. The
> real evidence is the `invalid opcode` in dmesg.
