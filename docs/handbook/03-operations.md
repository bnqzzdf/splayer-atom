# SPlayer Atom 运维手册

> 最后更新：2026-10-26
>
> 代码基线：`dev` 分支提交 `5693b3fc`，产品版本 `1.1.3`
>
> 读者：部署、运维、值班与验收人员

## 1. 运维对象与边界

SPlayer Atom 在目标机上表现为：

- 一个常驻 **Core** 服务（Node 进程），监听 HTTP/WS；
- 两个可选子进程：插件 host、ListenBrainz child；
- 一组持久数据：`<安装根>/data/`；
- 一组可重建缓存：XDG 缓存目录；
- 一个 Web Control 静态站点，由 Core 同端口提供。

运维的核心边界：

- Core **没有身份认证、没有 TLS**，只应部署在可信局域网或带认证的反向代理之后。
- Core **不删除用户音乐文件**；清理只涉及 Atom 自己的缓存、临时文件与未完成下载。
- `data/` 是权威持久状态；缓存可以丢，`data/` 不能丢。
- 升级必须保留完整旧安装，回滚不依赖“旧二进制读新数据”。

## 2. 部署形态与环境前提

### 2.1 产物形态

| 形态 | Node 来源 | 目标机要求 |
| --- | --- | --- |
| system-runtime | 宿主机 Node | Node `>=22.19.0` |
| bundled-runtime | 包内 `runtime/bin/node` | 不需要系统 Node |
| Debian 11 bundled | 包内 Node | glibc `>=2.30` |
| Diretta 变体 | 视构建方式 | root、SDK 148、匹配 CPU 变体 |

### 2.2 环境前提清单

| 实体 | 满足判据 | 检查方式 |
| --- | --- | --- |
| Linux x86-64 | `uname -m` 为 `x86_64` | `uname -m` |
| glibc | Debian 11 包要求 `>=2.30` | `ldd --version` |
| Node（system 包） | `>=22.19.0` | `node --version` |
| 服务账户 | 已存在，能读写 `data/` 与缓存目录 | `id <user>`、`sudo -u <user> test -w ...` |
| ALSA 设备 | 目标用户能访问 `/dev/snd/*` | `aplay -l`、`id <user>` |
| ALSA 开发库（仅构建） | `libasound2-dev` | `pkg-config --exists alsa` |
| 端口 14558 | 未被占用 | `ss -ltnp \| grep 14558` |
| 数据目录 | 可写、足够空间 | `df -h`、`test -w` |
| 缓存目录 | 可写、足够空间 | `df -h` |
| Diretta（可选） | root、SDK 148 产物、Target 独占可用 | `/api/info`、硬件验收 |
| UPnP（可选） | Renderer 可达、SSDP 多播可达 | `/api/output/devices` |
| 在线平台（可选） | 出站 443、账号有效 | 平台登录与播放测试 |

### 2.3 端口

| 端口 | 协议 | 方向 | 用途 |
| --- | --- | --- | --- |
| 14558 | TCP | 入站 | Core HTTP + WebSocket + Web Control |
| 1900 | UDP | 出站/组播 | SSDP 发现 |
| 随机 | TCP | 入站 | UPnP 媒体服务（Renderer 拉流） |
| 随机 | TCP | 入站 | Qobuz OAuth 本地回调 |
| 443 | TCP | 出站 | 在线平台、ListenBrainz、插件安装 |

### 2.4 现场核对结论（2026-10-26）

对一台 GentooPlayer x86-64-v2 实机做过一次**只读**核对（不记录地址与凭据），可作为部署预期的参照：

| 项目 | 现场值 | 结论 |
| --- | --- | --- |
| init 系统 | OpenRC，`rc-service status` 返回 `started` | 与 `install-openrc.sh` 路径一致 |
| 运行用户 | root | Diretta 场景需要 root |
| Node | 系统 `v22.15.0`；实际进程使用包内 `v24.18.0` | 系统 Node 低于 `>=22.19.0`，**必须使用 bundled-runtime** |
| 产物 | `1.1.3` / `087d8fb` / `sourceDirty:false` / Diretta SDK 150 / `v2` | 与 `runtime.json` 一致 |
| 能力位 | `diretta:true`，`remoteOutput:false` | `remoteOutput` 恒 false 不代表 UPnP 不可用 |
| 输出扫描 | 同时返回 Diretta Target 与 UPnP Renderer，当前选中 UPnP | 多输出共存正常 |
| 曲库 | 1134 首 | 扫描与 SQLite 正常 |
| 缓存 | 封面约 12 MiB，其余为空 | 缓存可重建 |
| 磁盘 | 根分区约 91% 已用、剩余约 10 GB | 上线前应评估缓存/下载/备份空间 |

注意：该实机运行的是 `087d8fb`，本文档基线是 `5693b3fc`；目录布局、端口与 API 契约一致，但具体行为以目标产物为准。不要把现场结论当作“文档基线已在该主机验收”的证据。

## 3. 安装前检查

```bash
uname -m
ldd --version | head -1
node --version                 # system 包
ss -ltnp | grep 14558 || true
df -h /opt /var/cache "$HOME"
id splayer-atom                # 服务账户
```

检查清单：

- [ ] 目标机是 Linux x86-64。
- [ ] system 包有 Node `>=22.19.0`；否则改用 bundled 包。
- [ ] Debian 11 目标使用 `package:core:debian11` 产物。
- [ ] 服务账户已创建，且对安装根、`data/`、缓存目录有写权限。
- [ ] 14558 未被旧 `splayer-headless` 或其他服务占用。
- [ ] 使用 Diretta 时确认以 root 运行，且 Target 未被其他 Host 占用。
- [ ] 使用 UPnP 时确认 Core 主机与 Renderer 在同一可达网段，防火墙允许随机 TCP 端口。
- [ ] 备份磁盘有足够空间。

## 4. 安装

### 4.1 解包

归档内容就是安装根，**没有外层目录**：

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-*-linux-x64.tar.gz -C /opt/splayer-atom-core
```

布局：

```text
/opt/splayer-atom-core/
├─ app/                 Core JS
├─ renderer/            Web Control
├─ native/              audio-engine.node、streaming-api.node、build.json
├─ node_modules/        better-sqlite3
├─ bin/splayer-atom-core
├─ service/             systemd/OpenRC 定义与安装器
├─ docs/core-deployment.md
├─ data/                持久状态（初始为空）
├─ runtime/             仅 bundled：bin/node
├─ runtime.json
└─ LICENSE
```

### 4.2 手工验证启动

安装服务前先手工启动，确认能监听：

```bash
cd /opt/splayer-atom-core
./bin/splayer-atom-core
```

看到启动日志后，另开终端：

```bash
curl -s http://127.0.0.1:14558/api/info
```

确认 `version`、`commit`、`protocol.version`、`capabilities` 符合预期后，`Ctrl+C` 退出。

### 4.3 systemd 安装

先创建专用服务账户（安装器不会创建用户）：

```bash
sudo useradd --system --home /opt/splayer-atom-core --shell /usr/sbin/nologin splayer-atom
sudo chown -R splayer-atom:splayer-atom /opt/splayer-atom-core/data
```

安装 unit：

```bash
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl enable --now splayer-atom-core
```

Diretta 需要 root：

```bash
sudo ./service/install-systemd.sh --diretta
sudo systemctl enable --now splayer-atom-core
```

安装器行为：

- 必须以 root 运行；
- `--user <name>` 要求用户已存在；
- 把 unit 的 `WorkingDirectory`/`ExecStart` 改写到实际安装根；
- 安装到 `/etc/systemd/system/splayer-atom-core.service`；
- **只执行 `daemon-reload`，不自动 enable/start**。

### 4.4 OpenRC 安装（GentooPlayer）

```bash
cd /opt/splayer-atom-core
sudo ./service/install-openrc.sh --user splayer-atom
# 或
sudo ./service/install-openrc.sh --diretta

sudo rc-update add splayer-atom-core default
sudo rc-service splayer-atom-core start
```

安装器行为：

- 需要 `/sbin/openrc-run` 与 `rc-update`，systemd 主机会直接拒绝；
- 写 `/etc/init.d/splayer-atom-core` 与 `/etc/conf.d/splayer-atom-core`；
- 非默认安装根会改写 init 脚本里的字面 `command=` 路径；
- 保留 conf.d 中用户自己追加的行；
- 不自动 `rc-update add` 或启动；
- 若检测到 GentooPlayer 探针，会运行并打印结果；若显示 `NOT INSTALLED`，会给出 WARNING。

### 4.5 首次访问

浏览器打开：

```text
http://<Core 主机 IP>:14558
```

若通过域名/反向代理访问，必须设置 `ATOM_ALLOWED_HOSTS`，并让代理保留原始 Host 头。

## 5. 目录、权限与数据

### 5.1 目录表

| 路径 | 内容 | 持久性 | 备份 |
| --- | --- | --- | --- |
| `<安装根>/data/` | 配置、数据库、插件、迁移备份 | 权威 | 必须 |
| `data/config/settings.json` | Core 设置 | 权威 | 必须 |
| `data/config/qobuz.json` | Qobuz 凭据 | 权威 | 必须（含明文编码） |
| `data/config/tidal.json` | TIDAL 凭据 | 权威 | 必须 |
| `data/config/listenbrainz.json` | ListenBrainz token | 权威 | 必须 |
| `data/config/streaming.json` | 自建流媒体服务器配置 | 权威 | 必须 |
| `data/database/library.db` | 曲库、队列、统计、下载、歌词缓存 | 权威 | 必须 |
| `data/database/listenbrainz-outbox.db` | LB outbox | 权威 | 建议 |
| `data/plugins/` | 插件脚本、数据、manifest | 权威 | 建议 |
| `data/backups/migration-*` | 迁移前快照 | 诊断 | 按策略保留 |
| `~/.cache/splayer-atom/` | 图片/歌曲缓存、下载临时文件 | 可重建 | 不需要 |
| `~/Music/SPlayer Atom Core/` | 默认下载目录 | 用户媒体 | 用户自行 |

### 5.2 权限

推荐：

```bash
sudo chown -R splayer-atom:splayer-atom /opt/splayer-atom-core/data
sudo chmod 700 /opt/splayer-atom-core/data
sudo find /opt/splayer-atom-core/data -type f -exec chmod 600 {} +
```

说明：

- 凭据文件由程序写后 `0600`；`runtimeSecretCodec` 只是 `plain:<base64>`，不是加密。
- `account_sessions` 表中的第三方 Cookie 以 JSON 明文存入 SQLite；数据库文件权限必须收紧。
- 迁移备份包含 `config/` 与数据库快照，同样含敏感数据。
- 服务账户还需要 ALSA 设备访问权限（通常加入 `audio` 组）与缓存目录写权限。

## 6. 配置

### 6.1 运行时环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ATOM_SERVER_PORT` | `14558` | 监听端口；非法值回退 14558 |
| `ATOM_ALLOWED_HOSTS` | 空 | 逗号分隔的额外 Host 白名单 |
| `ATOM_DATA_DIR` | 打包 `<安装根>/data` | 数据根；改变不会自动迁移 |
| `ATOM_CACHE_DIR` | `$XDG_CACHE_HOME/splayer-atom` 或 `~/.cache/splayer-atom` | 缓存根 |
| `ATOM_MUSIC_DIR` | `~/Music` | 默认下载目录父目录 |
| `ATOM_NODE_BIN` | 空 | 启动器优先使用的 Node |
| `ATOM_WEB_DEV_URL` | 空 | 仅开发：允许同主机任意端口与 CORS |
| `ATOM_APP_NAME` | `SPlayer Atom Core` | 应用名 |
| `ATOM_APP_VERSION` | `1.0.0` 或 `runtime.json.atomVersion` | 版本覆盖 |
| `ATOM_COMMIT` | `runtime.json.atomCommit` 或 `unknown` | 提交覆盖 |
| `ATOM_SOURCE_DIRTY` | `runtime.json.sourceDirty` | 仅 `"1"` 视为 true |
| `ATOM_NATIVE_DIR` | `<安装根>/native` | 原生模块目录 |
| `ATOM_RENDERER_DIR` | `<安装根>/renderer` | Web 静态目录 |
| `ATOM_RESOURCES_DIR` | 启动器设为安装根 | `runtime.json` 查找根 |
| `ATOM_TEMP_DIR` | `os.tmpdir()` | 仅 TIDAL materialization |
| `NODE_ENV` | 启动器设为 `production` | 影响打包标志 |
| `QOBUZ_*` | 空 | Qobuz 凭据覆盖 |
| `TIDAL_*` | 空 | TIDAL 凭据覆盖 |

注意：

- `QOBUZ_*` / `TIDAL_*` 环境变量会覆盖 UI 登录结果，并可能出现在进程环境中。生产环境优先使用 UI 登录 + 0600 文件。
- `ATOM_DATA_DIR` 改变后旧数据不会自动迁移，必须手工复制。
- `ATOM_CACHE_DIR` 在打包启动时会被 Core 入口设置为 XDG 缓存；设置里的 `cache.dir` 优先级更高。

### 6.2 systemd 配置

临时覆盖：

```bash
sudo systemctl edit splayer-atom-core
```

示例：

```ini
[Service]
Environment=ATOM_SERVER_PORT=14558
Environment=ATOM_ALLOWED_HOSTS=music.example.com
Environment=ATOM_DATA_DIR=/srv/splayer-atom/data
```

应用：

```bash
sudo systemctl daemon-reload
sudo systemctl restart splayer-atom-core
```

### 6.3 OpenRC 配置

编辑 `/etc/conf.d/splayer-atom-core`：

```sh
# 安装根（仅非默认时）
# SPLAYER_ATOM_ROOT="/opt/splayer-atom-core"
# 运行用户
# command_user="splayer-atom"
# Core 环境变量必须 export
export ATOM_SERVER_PORT=14558
export ATOM_ALLOWED_HOSTS=music.example.com
```

OpenRC 先 source conf.d，再执行 init 脚本。

### 6.4 反向代理

Core 只支持同源请求。反代必须：

- 保留原始 `Host`：`proxy_set_header Host $host;`
- 支持 WebSocket Upgrade；
- 把公网域名加入 `ATOM_ALLOWED_HOSTS`；
- 最好在代理层加 TLS 与认证。

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name music.example.com;

    location / {
        proxy_pass http://127.0.0.1:14558;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

如果代理把 Host 改写成 `127.0.0.1`，浏览器 Origin 仍是公网域名，会被 `requestGuard` 拒绝为 `cross-origin request rejected`。

## 7. 服务生命周期

### 7.1 systemd

```bash
sudo systemctl start splayer-atom-core
sudo systemctl stop splayer-atom-core
sudo systemctl restart splayer-atom-core
sudo systemctl status splayer-atom-core
sudo systemctl enable splayer-atom-core
sudo systemctl disable splayer-atom-core
journalctl -u splayer-atom-core -n 200 --no-pager
journalctl -u splayer-atom-core -f
```

unit 关键配置：

- `Restart=on-failure`、`RestartSec=3`
- `LimitRTPRIO=95`、`LimitMEMLOCK=infinity`
- `Environment=NODE_ENV=production`

### 7.2 OpenRC

```bash
sudo rc-service splayer-atom-core start
sudo rc-service splayer-atom-core stop
sudo rc-service splayer-atom-core restart
rc-service splayer-atom-core status    # 0=started, 3=stopped
sudo rc-update add splayer-atom-core default
sudo rc-update del splayer-atom-core default
tail -n 100 /var/log/splayer-atom-core.log
tail -n 100 /var/log/splayer-atom-core.err.log
```

OpenRC 使用 `supervise-daemon`，有界重启：

- `respawn_delay=5`
- `respawn_period=120`
- `respawn_max=10`

`respawn_max=0` 会变成无限重启，把“起不来的二进制”隐藏成 `status=started` 的静默崩溃环，禁止这样配置。

### 7.3 停止语义

SIGTERM/SIGINT 只 flush 设置后退出，不会优雅关闭：

- UPnP 媒体 server
- 插件 host 子进程
- ListenBrainz child
- Direct/UPnP 临时文件
- 播放统计

这些依赖进程组退出与下次启动清理。停止后若发现 `/tmp/splayer-atom-*` 残留，可按 PID 目录清理。

## 8. 音频输出运维

### 8.1 ALSA

- Core 只枚举真实 hw playback PCM，不返回 `default`/`plughw`/`softvol`。
- 设备 ID 为 `alsa:hw:CARD=<card_id>,DEV=<n>`。
- Processed：仅 mono/stereo；可 EQ/响度/变速；优先源采样率，不做 ALSA resample。
- Direct：保留有效位；整数不转 float；支持原生 DSD；不支持源表示时显式失败。
- 启动时只有在候选唯一时才自动选择 ALSA hw；否则需在 Web 中选择。

常见检查：

```bash
aplay -l
cat /proc/asound/cards
curl -s http://127.0.0.1:14558/api/output/devices
```

### 8.2 Diretta

前提：

1. 产物编译了 Diretta（`/api/info.capabilities.diretta === true`）。
2. Core 以 root 运行（`install-systemd.sh --diretta` 或 `install-openrc.sh --diretta`）。
3. SDK 148、CPU 变体与目标机匹配。
4. Target 独占可用，未被其他 Host 占用。
5. 源为 lossless integer PCM 或原生 DSD。

约束：

- 不做重采样、混音、归一化、EQ、非单位增益、淡入淡出、变速、变调、DoP、DSD 转 PCM。
- staged 下一首必须与当前 connection 的 wire-format 一致。
- PCM ↔ Native DSD 不能在同一 runtime 直接切换。
- 多声道、Float32、有损编码会被拒绝。
- 拒绝是预期行为，不是“缺少回退”。

检查：

```bash
curl -s http://127.0.0.1:14558/api/info | grep -E 'diretta|direttaSdkRelease'
cat /opt/splayer-atom-core/native/build.json
dmesg | grep -i 'invalid opcode'    # SIGILL：CPU 变体不匹配
```

### 8.3 UPnP

- Core 自有单 Renderer 路径；同时只支持一个选中 Renderer。
- 发现使用 SSDP（239.255.255.250:1900），媒体通过 Core 临时 HTTP 端口提供。
- 无 gapless；每首重新加载 URI；结束判定为 1 秒轮询 + near-end 启发式。
- CUE/SACD 会生成临时 WAV/DSF；需要磁盘空间。
- 多声道、非整数无损 CUE 会被拒绝。

检查：

```bash
curl -s http://127.0.0.1:14558/api/output/devices
ss -ltnp | grep node     # 查看临时媒体端口
```

防火墙需允许 Renderer 访问 Core 的随机 TCP 端口，以及 Core 发出 SSDP 多播。

### 8.4 实时优先级

systemd unit 已设置：

```ini
LimitRTPRIO=95
LimitMEMLOCK=infinity
```

OpenRC `start_pre()` 执行：

```sh
ulimit -l unlimited
ulimit -r 95
```

失败不阻断启动，但输出写线程会降级为普通优先级。若出现爆音/卡顿，先确认这些限制生效。

## 9. 曲库运维

### 9.1 扫描

- 一个 Core 同时只允许一个扫描。
- 增量扫描按 mtime/size 跳过未变化文件。
- 删除检测只针对扫描范围内、不可达目录不会被视为删除。
- 扫描进度只在内存，重启丢失。
- 扫描完成后发布 `libraryChanged` revision，不推送全量库。

操作路径：

- Web：设置 → 本地曲库 → 添加目录 → 扫描。
- API：`POST /api/library/scan`、`GET /api/library/scan-progress`、`POST /api/library/scan/cancel`。

### 9.2 目录移除

`DELETE /api/library/scan-dirs` 会：

- 删除该目录下的数据库记录；
- 取消正在进行的扫描；
- 移除相关 pin；
- **不删除音乐文件**。

### 9.3 大库注意事项

- SQLite 同步 API 会占用 Node event loop；大库查询/大队列写入可能造成短时卡顿。
- 每次 session publish 会序列化整队列写入 SQLite；大队列高频编辑有写放大。
- 文件夹搜索最多遍历 100,000 项，超过会返回 `truncated:true`。

## 10. 在线账号与凭据

### 10.1 登录方式

| 平台 | 方式 | 凭据位置 |
| --- | --- | --- |
| 网易云 | 扫码 / 手动 Cookie | `account_sessions` |
| QQ 音乐 | QQ/微信扫码 / 手动 Cookie | `account_sessions` |
| 酷狗 | 扫码 / 手动 Cookie | `account_sessions` |
| Qobuz | 浏览器 OAuth / token | `config/qobuz.json` |
| TIDAL | PKCE 回调 / 设备码 / token | `config/tidal.json` |
| 自建流媒体 | 用户名/密码 | `config/streaming.json` |

### 10.2 凭据保护

- 文件权限 `0600`，`data/` 建议 `0700`。
- `runtimeSecretCodec` 是 base64 编码，不是加密；备份等同于备份明文凭据。
- 环境变量 `QOBUZ_*`/`TIDAL_*` 会覆盖 UI 登录结果，生产环境谨慎使用。
- 不要把 `data/` 放进可公开访问的目录或普通网盘同步。

### 10.3 登录失效

- 网易云：`NETEASE_LOGIN_EXPIRED`；重新扫码/Cookie。
- QQ/酷狗：`PROVIDER_LOGIN_REQUIRED` 或权益错误；重新登录。
- Qobuz/TIDAL：token 刷新失败时重新授权；TIDAL 设备码仅 AAC，官方 PKCE 才有无损。
- 自建流媒体：401/403 会自动失效会话并重试一次；持续失败检查地址/账号/网络。

## 11. 缓存、下载、插件、ListenBrainz

### 11.1 缓存

- 缓存根默认 `~/.cache/splayer-atom`。
- 子目录：`covers/`、`artists/`、`backgrounds/`、`songs/`、`downloads-tmp/`。
- 歌曲缓存默认关闭；开启后可设上限（默认 10 GB，0 表示不限）。
- 图片缓存无自动上限，需要定期清理。
- 切换缓存目录要求目标为空，并会清空旧的文件类缓存；数据库类歌词缓存不受影响。

巡检：

```bash
curl -s http://127.0.0.1:14558/api/cache/stats
du -sh ~/.cache/splayer-atom/*
```

清理：

- Web：设置 → 本地与缓存。
- API：`POST /api/cache/clear`、`POST /api/cache/clear-all`。

### 11.2 下载

- 下载默认关闭；在设置中启用。
- 默认目录 `~/Music/SPlayer Atom Core`。
- 串行下载；同曲同音质去重；无断点续传。
- 临时文件在 `<缓存根>/downloads-tmp`；启动时清理，未完成任务标记 `interrupted`。
- 删除任务不会删除已完成的音乐文件。

巡检：

```bash
curl -s http://127.0.0.1:14558/api/download/tasks
df -h ~/Music
```

### 11.3 插件

- 插件安装在 `data/plugins/`。
- host 崩溃按 2s → 8s → 30s 退避重启，超过 3 次置 error。
- 插件共享一个 host 事件循环；一个插件长时间阻塞会拖住其他插件。
- 只安装可信来源的 HTTPS 脚本；安装 URL 是远程代码入口。
- 插件日志汇入 Core stdout，不是单独文件。

巡检：

```bash
curl -s http://127.0.0.1:14558/api/plugins
```

### 11.4 ListenBrainz

- 默认关闭；关闭时不做任何后台工作。
- 启用后 token 校验与上报在独立子进程；outbox 在 `data/database/listenbrainz-outbox.db`。
- 401 → `auth_error`；408/429/5xx → 指数退避，上限 30 分钟；其他 4xx → `dead`。
- child 崩溃 5 秒后重启；没有心跳，卡死不会自动重启。
- 阈值：`min(曲目时长/2, 240 秒)`。

巡检：

```bash
curl -s http://127.0.0.1:14558/api/listenbrainz/status
```

## 12. 备份、升级、回滚、卸载

### 12.1 备份

最低要求：

```bash
sudo systemctl stop splayer-atom-core
sudo tar -czf /backup/splayer-atom-data-$(date +%F).tar.gz \
  -C /opt/splayer-atom-core data
sudo systemctl start splayer-atom-core
```

说明：

- SQLite 使用 WAL；运行中只复制 `library.db` 可能漏 WAL。停机备份最稳。
- 迁移备份在 `data/backups/migration-*`，包含 DB 快照与 config；它不是“旧版本回滚副本”的替代。
- 备份包含明文编码凭据，必须加密/限权保存。

### 12.2 升级步骤

1. 停服务并确认停止：

```bash
sudo systemctl stop splayer-atom-core
sudo systemctl is-active splayer-atom-core
```

2. 保留完整旧安装（含旧 `data/`）：

```bash
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.rollback
```

3. 解包新产物：

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf <新产物>.tar.gz -C /opt/splayer-atom-core
```

4. 用旧 `data/` 的副本替换新产物空 `data/`：

```bash
sudo rm -rf /opt/splayer-atom-core/data
sudo cp -a /opt/splayer-atom-core.rollback/data /opt/splayer-atom-core/data
```

5. 重装服务定义并启动：

```bash
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
# 或 --diretta
sudo systemctl start splayer-atom-core
```

6. 验收：

```bash
curl -s http://127.0.0.1:14558/api/info
curl -s http://127.0.0.1:14558/api/session
curl -s http://127.0.0.1:14558/api/library/count
curl -s http://127.0.0.1:14558/api/cache/stats
```

原则：

- 不在运行中的安装上直接覆盖解包。
- 用 `cp -a` 复制旧 `data/`，不要移动。
- 旧二进制不得读取已被新 Core 迁移过的数据。
- Core 拒绝高于支持版本的 schema；不要删库绕过。

### 12.3 回滚

```bash
sudo systemctl stop splayer-atom-core
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl start splayer-atom-core
```

保留失败安装与迁移备份用于诊断，不要立即删除。

OpenRC 对应：

```bash
sudo rc-service splayer-atom-core stop
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
cd /opt/splayer-atom-core
sudo ./service/install-openrc.sh --user splayer-atom
sudo rc-service splayer-atom-core start
```

### 12.4 卸载

仓库没有卸载脚本，以下为按现有服务资产推导的步骤。

systemd：

```bash
sudo systemctl disable --now splayer-atom-core
sudo rm -f /etc/systemd/system/splayer-atom-core.service
sudo systemctl daemon-reload
# 不可逆：删除安装与数据
# sudo rm -rf /opt/splayer-atom-core
```

OpenRC：

```bash
sudo rc-service splayer-atom-core stop
sudo rc-update del splayer-atom-core default
sudo rm -f /etc/init.d/splayer-atom-core /etc/conf.d/splayer-atom-core
# 不可逆：删除安装与数据
# sudo rm -rf /opt/splayer-atom-core
```

还需按需清理：

- `~/.cache/splayer-atom/`
- `/tmp/splayer-atom-*`
- 服务账户（如果不再使用）
- 备份中的 `data/`

## 13. 巡检清单

### 13.1 每日/每周

- [ ] 服务状态：`systemctl status` 或 `rc-service status`。
- [ ] 端口监听：`ss -ltnp | grep 14558`。
- [ ] `/api/info` 版本/commit 未意外变化。
- [ ] `/api/session` 队列正常，无异常空队列。
- [ ] `/api/output/devices` 目标设备仍在。
- [ ] `/api/cache/stats` 缓存未失控增长。
- [ ] 磁盘：安装根、缓存、下载目录。
- [ ] 日志无 schema 拒绝、端口冲突、反复崩溃。
- [ ] OpenRC：`/var/log/splayer-atom-core.err.log` 大小与内容。

### 13.2 每月

- [ ] 备份 `data/` 并验证可读。
- [ ] 清理 `data/backups/migration-*` 中过期快照。
- [ ] 检查插件版本与来源。
- [ ] 检查在线平台登录是否仍有效。
- [ ] 检查 ListenBrainz `pending`/`dead` 计数。
- [ ] 评估缓存目录与下载目录容量。

## 14. 故障排查

### 14.1 启动失败

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `Node runtime not found` | system 包无 Node 或 `ATOM_NODE_BIN` 错误 | 安装 Node `>=22.19` 或改用 bundled |
| Node 版本过低 | `<22.19.0` | 升级 Node |
| `EADDRINUSE` | 14558 被占用 | `ss -ltnp \| grep 14558`；停旧服务或改端口 |
| `EACCES` | 服务用户无 `data/` 或缓存权限 | `chown`/`chmod` |
| `ERR_DLOPEN_FAILED` / `GLIBC_2.xx not found` | 产物与目标 glibc 不匹配 | 用 Debian 11 构建包 |
| schema 版本高于支持 | 旧二进制读新数据 | 恢复完整旧安装 |
| Diretta 非 root | 权限检查 | `--diretta` 安装 |
| `status=started` 但接口不通 | OpenRC 无限重启或进程已死 | 查 err.log；确认 `respawn_max>0` |

### 14.2 浏览器打不开 / 403

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 连接被拒 | 服务未监听/防火墙 | 查服务与端口 |
| `untrusted host` | 域名不在白名单 | `ATOM_ALLOWED_HOSTS` |
| `cross-origin request rejected` | 反向代理改写 Host | 保留原始 Host |
| `opaque origin rejected` | `file://`/sandbox iframe | 用正常 http(s) 访问 |
| WS 连不上 | 代理不支持 Upgrade | 配置 WebSocket 转发 |
| 页面白屏 | 静态资源 404 | 确认 `renderer/` 存在、版本匹配 |

### 14.3 播放失败

| 错误 | 含义 | 处理 |
| --- | --- | --- |
| `OUTPUT_DEVICE_REQUIRED` | 未选择输出 | 在 Web 选择 ALSA/Diretta/UPnP |
| `DEVICE_NOT_FOUND` | 设备消失 | 检查 `aplay -l`/Renderer，重新选择 |
| `OUTPUT_FORMAT_UNSUPPORTED` | 当前输出不接受该格式 | 换输出或换源；Diretta 不会回退 |
| `NETWORK_ERROR` / `NETWORK_TIMEOUT` | 音源网络失败 | 检查网络/代理/平台 |
| `URL_RESOLVE_FAILED` | 官方与插件都拿不到 URL | 检查登录/权益/插件 |
| `PROVIDER_VIP_REQUIRED` / `NETEASE_VIP_REQUIRED` | 会员权益 | 使用有权益账号或换源 |
| `FILE_DECODE_ERROR` | 文件损坏/缓存坏 | 重新扫描；缓存会失效重下 |
| `outputFailed` / `outputStalled` | 输出流失败/停滞 | 播放暂停；重新选择输出或 reinit |
| 连续失败后停止 | 达到 `min(5, 队列长度)` | 查具体错误码；设备类错误不跳过 |

### 14.4 Diretta

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 设备列表无 Diretta | 产物未编译 SDK | `/api/info.capabilities.diretta` |
| 设置 Diretta 报权限 | 非 root | 用 `--diretta` |
| `SIGILL` / `invalid opcode` | CPU 变体不匹配 | 用更低变体重建（v2 最保守） |
| 连接失败 | Target 被占用/网络 | 独占 Target、检查链路 |
| 格式拒绝 | 非无损整数 PCM / 跨 wire-format | 换源；这是设计行为 |
| 无声但状态播放 | 音量/EQ 被锁定为 1 | 检查 DAC/前级，不是 Core 音量 |

### 14.5 UPnP

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 设备列表为空 | SSDP 不通/防火墙 | 检查多播与网段 |
| 能发现不能播放 | Renderer 无法拉流 | 放行 Core 随机 TCP 端口 |
| 播放中断 | Renderer 不支持格式 | 查 Renderer 兼容性 |
| 不自动下一首 | 轮询未判定 near-end | 检查时长/位置；UPnP 无 gapless |
| CUE/SACD 失败 | 多声道/非整数无损/缺 track | 用支持格式或换输出 |

### 14.6 数据与升级

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 启动时拒绝 schema | 数据来自更新版本 | 回滚完整旧安装 |
| 迁移备份占空间 | 无自动清理 | 人工保留策略 |
| 改 `ATOM_DATA_DIR` 后曲库空 | 旧数据未迁移 | 手工复制 `data/` |
| 升级后设置丢失 | 未复制旧 `data/` | 从回滚目录 `cp -a` |
| 缓存目录切换失败 | 目标非空 | 换空目录或先清理 |

### 14.7 插件与 ListenBrainz

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 插件 `error` | 加载/运行失败/host 崩溃超限 | 看插件卡片错误；禁用/重装 |
| 插件全部不可用 | host 崩溃 | 等待 2/8/30s 重启；查日志 |
| 插件卡住播放 | 共享事件循环被阻塞 | 禁用可疑插件 |
| LB `auth_error` | token 失效 | 重新绑定 |
| LB `dead` 增长 | 4xx 负载错误 | 清空 outbox；检查 payload |
| LB `pending` 不降 | 网络/服务端故障 | 检查出站 443；等待退避 |

## 15. 安全加固

### 15.1 网络边界

- 不要把 14558 直接暴露到公网。
- 使用防火墙只放行可信 LAN：
  ```bash
  sudo ufw allow from 192.168.0.0/16 to any port 14558 proto tcp
  ```
- 需要远程访问时，用 VPN 或带 TLS + 认证的反向代理。
- Core 自身无 TLS；不要用明文 HTTP 跨不可信网络传输凭据。

### 15.2 主机权限

- 普通 ALSA 使用专用非 root 用户，加入 `audio` 组。
- Diretta 必须 root；尽量放在隔离主机，不要在同一 root 会话跑其他服务。
- `data/` 0700，文件 0600。
- 备份加密保存。

### 15.3 插件与在线内容

- 只安装可信来源插件。
- 插件可联网；不要给它不需要的权限。
- 不要把 `data/plugins/` 暴露给其他用户。

### 15.4 已知暴露面

- `/api/filesystem/directories` 可列主机目录。
- `/api/player/read-lyric` 可读 Core 进程可读的任意匹配扩展名文件。
- `/api/library/scan-dirs` 接受任意字符串数组，不验证目录。
- 标签写入的 `coverPath` 未限制在库根内。

这些在“可信 LAN 单用户”模型下可接受，但不应在不可信网络暴露。

## 16. 环境 vs 代码边界（R10）

运维看到的是日志与状态，不是源码。以下现象应优先按环境处理：

| 现象 | 环境侧 | 代码侧 |
| --- | --- | --- |
| 启动即退出 | Node 版本、端口、权限、schema、缺库 | 启动编排、迁移 bug |
| 播放无声 | 输出设备、DAC、线缆、权限、Target 占用 | 解码、格式协商、输出选择 |
| Diretta 失败 | 非 root、CPU 变体、SDK、Target | 格式检查、staging 逻辑 |
| UPnP 失败 | 网段、防火墙、Renderer 兼容性 | 发现、媒体服务、结束判定 |
| 403 | Host/Origin/反代配置 | 守卫规则 |
| 卡顿/爆音 | CPU、实时权限、内存锁、DAC buffer | DSP/缓冲/线程 |
| 在线播放失败 | 账号、权益、网络、平台变更 | resolver、插件、错误分类 |
| 曲库缺失 | 目录权限、挂载、NAS 可达 | 扫描/删除检测 |
| 磁盘增长 | 缓存/下载/备份策略 | 淘汰逻辑 |

处置顺序：

1. 先确认服务、端口、版本、日志。
2. 再确认输出设备与格式。
3. 再确认网络/账号/权限。
4. 最后才怀疑代码；保留 `/api/info`、日志、复现步骤与产物身份。

## 17. 验收清单

### 17.1 软件验收

- [ ] `/api/info` 的 `version`/`commit`/`protocol`/`capabilities` 符合产物。
- [ ] Web 根页可打开。
- [ ] `/api/session`、`/api/status`、`/api/output/devices` 正常。
- [ ] WebSocket 可连接并收到 `hello`。
- [ ] 重启后队列/设置/曲库恢复。
- [ ] SIGTERM 退出码 0。
- [ ] 迁移备份（如发生迁移）存在且可读。

### 17.2 硬件验收

- [ ] ALSA Processed：常见格式、seek、变速/变调、EQ。
- [ ] ALSA Direct：PCM/DSD、格式拒绝、切换。
- [ ] Diretta：PCM/DSD、exact-format、CUE 无缝、seek、长时运行。
- [ ] UPnP：常见格式、CUE、SACD、DSD、输出切换、长时资源。
- [ ] 输出切换失败回滚。
- [ ] 自动下一首/连续失败停止。

### 17.3 账号验收

- [ ] 网易云、QQ、酷狗、Qobuz、TIDAL 各自登录、搜索、播放、歌词。
- [ ] 权益/试听/购买错误分类正确。
- [ ] 自建流媒体连接、同步、搜索、播放、歌词。

## 18. 附录

### 18.1 常用命令

```bash
# 服务
systemctl status splayer-atom-core
journalctl -u splayer-atom-core -n 200 --no-pager
rc-service splayer-atom-core status
tail -n 100 /var/log/splayer-atom-core.err.log

# 端口/进程
ss -ltnp | grep 14558
ps -ef | grep splayer-atom-core

# API
curl -s http://127.0.0.1:14558/api/info
curl -s http://127.0.0.1:14558/api/status
curl -s http://127.0.0.1:14558/api/session
curl -s http://127.0.0.1:14558/api/output/devices
curl -s http://127.0.0.1:14558/api/cache/stats
curl -s http://127.0.0.1:14558/api/download/tasks
curl -s http://127.0.0.1:14558/api/plugins
curl -s http://127.0.0.1:14558/api/listenbrainz/status

# 磁盘
du -sh /opt/splayer-atom-core/data
du -sh ~/.cache/splayer-atom
df -h

# 产物身份
cat /opt/splayer-atom-core/runtime.json
cat /opt/splayer-atom-core/native/build.json
sha256sum splayer-atom-core-*.tar.gz

# glibc 符号
readelf --version-info native/audio-engine.node \
  | grep -oE 'GLIBC_[0-9.]+' | sort -V | tail -1

# CPU 变体错误
dmesg | grep -i 'invalid opcode'
```

### 18.2 数据文件速查

```text
data/config/settings.json
data/config/qobuz.json
data/config/tidal.json
data/config/listenbrainz.json
data/config/streaming.json
data/database/library.db
data/database/listenbrainz-outbox.db
data/plugins/manifest.json
data/plugins/scripts/
data/plugins/data/
data/backups/migration-*/
```

### 18.3 相关文档

- [Core 部署与升级](../core-deployment.md)
- [GentooPlayer / OpenRC](../gentooplayer-openrc.md)
- [构建与打包](../build-and-packaging.md)
- [CPU 变体](../cpu-variants.md)
- [硬件发布验收](../hardware-release-checklist.md)
- [Diretta 排障](../troubleshooting/diretta-headless-troubleshooting.md)
- [项目书](./01-project.md)
- [程序接口文档](./05-api.md)
