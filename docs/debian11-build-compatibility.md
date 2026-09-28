# splayer-atom-core 1.1.0 · Debian 11 兼容构建说明

> 本文说明本次交付产物**为什么是 Debian 11 兼容的**、兼容性如何实测、以及为达成它做了什么。
> 本文由构建与验证过程直接产出，所有数字均为实测值。

---

## 一、产物指纹

| 项目 | 值 |
| --- | --- |
| 产物文件 | `splayer-atom-core-1.1.0-20260923-150342-bundled-linux-x64.tar.gz` |
| SHA256 | `b5ae8529430cc6d5a027ca41127eb31750f06f559961337b824dd1b8770bb231` |
| 大小 | 56,837,764 字节 |
| atomCommit | `07c2442d5f688fcf9e5050ca6bce9879f855abcb` |
| sourceDirty | `false`（改动已提交为 `07c2442`） |
| Diretta CPU 变体 | `v3` |
| Node 参考版本 | 24.18.0 |
| 构建日期 | 2026-09-23 |

---

## 二、glibc 兼容性：实测结论

构建容器为 **Debian 11 (bullseye)，glibc 2.31**。产物内三个原生组件的实测最高 glibc 符号需求：

| 组件 | 最高 glibc 需求 | 判定（阈值 2.31） |
| --- | --- | --- |
| `native/audio-engine.node` | **GLIBC_2.30** | ✅ 通过 |
| `native/streaming-api.node` | **GLIBC_2.30** | ✅ 通过 |
| `node_modules/better-sqlite3/prebuilds/linux-x64.node` | **GLIBC_2.29** | ✅ 通过 |

**结论：产物可在 glibc ≥ 2.30 的 Linux x86_64 上运行，即覆盖 Debian 11 及以上的目标机。**

构建流程内置了硬性校验：任一组件超过 `GLIBC_2.31` 会直接 `exit 1` 并拒绝出包，
因此「Debian 11 兼容」不是口头承诺，而是构建期的强制门禁。

参考：部署目标 `10.0.0.190`（GentooPlayer）实测 glibc 为 **2.43**，向下完全兼容本产物。

---

## 三、构建环境（可复现）

| 组件 | 版本 / 位置 |
| --- | --- |
| 构建主机 | `192.168.101.133`（Docker 29.7.2） |
| 基础镜像 | `debian:11`（bullseye） |
| 镜像内 glibc | 2.31 |
| Node.js | 24.18.0 |
| pnpm | 11.5.2 |
| Rust | 1.98.1（stable，minimal profile） |
| Diretta SDK | `DirettaHostSDK_150`（`/root/DirettaHostSDK_150`） |
| 构建镜像标签 | `splayer-atom-debian11-builder` |

> ⚠️ 该主机的 Docker **没有 bridge 网络**（无 `docker0`），
> 因此镜像构建与容器运行都必须显式加 `--network host`，否则报 `network bridge not found`。

---

## 四、为达成兼容所做的两处关键改动

### 1) glibc < 2.38 兼容层（必需，否则产物根本起不来）

**问题**：Diretta SDK 150 的 ACQUA 静态库是在 glibc ≥ 2.38 的系统上编译的，
其中两个目标文件引用了 C23 版的整数解析函数：

- `IPAddress.o` → `__isoc23_strtol`
- `FileInf.o` → `__isoc23_strtoll`

这两个符号直到 glibc 2.38 才由 libc 提供。在 Debian 11 上链接出的
`audio-engine.node` 会因 `undefined symbol: __isoc23_strtol` 而**加载失败**
（`ERR_DLOPEN_FAILED`）。SDK 里所有 glibc 变体（15v3/16v3/16v4/16zen4）都有此问题，
只有 musl 变体没有——但 musl 与 glibc 的 ABI 不兼容，无法用于 glibc 目标。

**做法**：新增 `native/diretta-sys/src/glibc_compat.c`，在 glibc < 2.38 时提供
转调到标准 `strtol` / `strtoll` 的 **weak 符号**。

**为什么是安全的**：

1. 引用这两个符号的只有配置与 IP 解析路径（`IPAddress.o`、`FileInf.o`），
   **不涉及音频 DSP**；它们解析的是点分十进制 IP 与普通十进制数值，
   **不会用到 C23 新增的 `0b` 二进制前缀**，因此转调后语义等价。
2. 用 `weak` 定义：在 glibc ≥ 2.38 的平台上该文件条件编译为空对象、不定义任何符号；
   即使两者同时存在，libc 的强符号也会优先，不会产生冲突。
3. 改动被限定在 `diretta-sys` 的构建脚本内，不影响其它组件的构建方式。

**风险与边界**：这是一处针对第三方预编译库的兼容性 workaround。
若日后 Diretta 发布在旧 glibc 上编译的 ACQUA 库，应移除本兼容层。

### 2) tokio `macros` feature（构建期发现）

`streaming-api` 的 OAuth 实现用到 `tokio::select!`（用于「新登录叫停旧监听」），
该宏需要 tokio 的 `macros` feature。因 `dev-dependencies` 恰好也开了 `macros`，
只跑 `cargo test` 不会暴露其缺失，必须用 `cargo build --release`（不含 dev-deps）
才能覆盖生产 feature 集。已在 `native/streaming-api/Cargo.toml` 补上并加注释说明。

---

## 五、复现步骤

仓库里已有打包好的入口，不需要手工拼 docker 命令：

```bash
# 建镜像 → 容器内构建 → 产出 debian11 产物，一条命令到底
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_150 \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v2

# 不带 Diretta（ALSA-only）
pnpm package:core:debian11 --without-diretta
```

宿主侧驱动是 `scripts/atom/build-debian11-bundled.sh`，容器内脚本是
[`docker/atom-debian11/build.sh`](https://github.com/bnqzzdf/splayer-atom/blob/dev/docker/atom-debian11/build.sh)，
镜像定义与用法见 [`docker/atom-debian11/README.md`](https://github.com/bnqzzdf/splayer-atom/blob/dev/docker/atom-debian11/README.md)。

容器内实际执行的核心命令：

```sh
pnpm install --frozen-lockfile
# better-sqlite3 必须从源码编译，以匹配 Debian 11 的 glibc
sqlite_dir=$(dirname "$(node -p "require.resolve('better-sqlite3/package.json')")")
npm --prefix "$sqlite_dir" run build-release
cp "$sqlite_dir/build/Release/better_sqlite3.node" "$sqlite_dir/prebuilds/linux-x64.node"

DIRETTA_SDK_ROOT=/root/DirettaHostSDK_150 DIRETTA_CPU_VARIANT=v3 \
  pnpm exec tsx scripts/atom/build-core-system.ts \
    --require-diretta --diretta-variant=v3 --bundle-node
```

产物位于 `out/splayer-atom-core-1.1.0-<date>-bundled-linux-x64.tar.gz`。

---

## 六、部署与验证结果（目标机 10.0.0.190）

部署保留了运行期数据目录 `data/`（config、database），仅替换产物本体。

**部署后状态**

```
commit=8cd2e2a6 dirty=True 平台位=5/5 [netease,qqmusic,kugou,qobuz,tidal]
rc-service splayer-atom-core status → started
```

**Qobuz OAuth 自动化验证（除真实浏览器登录外全部覆盖）**

| # | 检查项 | 结果 |
| --- | --- | --- |
| 1 | 接口已注册（负对照 `Unsupported Qobuz API`） | ✅ |
| 2 | `auth_oauth_start` 返回结构（url/port/redirectUri/state/expiresIn=180） | ✅ |
| 3 | 回环场景：不传 host → 绑 `127.0.0.1` | ✅ |
| 4 | 跨机场景：传 host → 绑 `0.0.0.0`，回调地址用该 host | ✅ |
| 5 | 重复 start → 旧监听立刻释放端口 | ✅ |
| 6 | 无关请求（favicon）404 后监听继续 | ✅ |
| 7 | 跨机可达（外部主机访问回调端口） | ✅ |
| 8 | 带正确 state 回调 → 200 + 成功页 | ✅ |
| 9 | 不带 state 回调 → 仍放行（Qobuz 不回传 state 时的关键容错） | ✅ |
| 10 | 错误 state → 400 拒绝 | ✅ |
| 11 | `error=access_denied` → 立即失败（实测 0 秒，未空等 180s） | ✅ |
| 12 | 回调后端口释放（`ss -ltn` 无残留） | ✅ |
| 13 | 假 code 兑换 → 请求正确到达 Qobuz 并回 404 | ✅ |
| 14 | 会话投影 `userId=2961963`（真实用户 id，非 app_id） | ✅ |

**真人端到端验证（2026-09-23 已完成 ✅）**

设备本身无图形浏览器，浏览器在用户 PC 上，因此这一步由真人在浏览器完成：

| 检查项 | 结果 |
| --- | --- |
| 点击授权链接 → 浏览器完成 Qobuz 登录 → 回跳设备回调端口 | ✅ 回调页显示「Qobuz 登录成功」 |
| 全程不需要 Console / F12 / 复制粘贴 | ✅ |
| 真实兑换成功，拿到 `user_auth_token` | ✅ |
| 会话投影 `userId=2961963`、`username=tomosak`（真实用户 id，非 app_id） | ✅ |
| 功能可用：`catalog_search` 返回结果（实测 Miles Davis 专辑 3 条） | ✅ |
| 登录完成后回调端口释放（`ss -ltn` 无残留） | ✅ |

**实测确认的兑换响应形状**（此前唯一未实测项）：

```json
{"status":"success","user_id":"2961963","display_name":"tomosak",
 "user_auth_token":"mDkSe-...","user":{"id":"2961963","login":"tomosak"},
 "is_active":false,"max_format_id":5}
```

即 `oauth/callback` 确实返回 `user_auth_token` 与 `user_id`，实现中的多键兼容解析取到了正确值，
无需修改。该账号为非订阅（`is_active=false`、`max_format_id=5`）。

---

## 七、已知约束

- 回调监听在跨机场景下绑定 `0.0.0.0`（否则用户 PC 上的浏览器无法回跳到设备）。
  风险由这些因素约束：端口随机、仅在登录期间存活、最长 180 秒、一次性、且授权码只能由 Qobuz 签发。
  若所在网段不可信，建议改用 SSH 隧道而非长期暴露。
- `state` 校验采取「带了但不匹配才拒绝，缺失则放行」：Qobuz 是否原样保留
  `redirect_url` 的 query 尚未经真实登录确认，强制要求会导致真实登录必然超时。
  真实登录成功后应复核此策略。
