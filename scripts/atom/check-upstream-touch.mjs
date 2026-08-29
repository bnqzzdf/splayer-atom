/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upstreamConfig = JSON.parse(
  readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
);
const upstreamRef = process.env.UPSTREAM_REF || upstreamConfig.acceptedBaseline;
// 31 个既有 Atom 集成触点，加 6 个经本地 Web/Headless 阶段验证后不可删除的必要 seam，
// 再加 1 个 Provider Accounts 挂载点、5 个 Host-only Control/Settings 收敛 seam，
// 7 个 Core Download 收敛 seam、4 个 Core filesystem / Library path 收敛 seam，
// 1 个 Library tag editor Host-action seam、1 个 Provider embedded-login Host-action seam，
// 2 个 Track Action Model / presentation seam、1 个 Collection Action Model seam、
// 1 个 Artist Action Model seam、3 个 Cover Action presentation/Favorites seam，
// 1 个 system-font Host gating seam、2 个最终 Host-action 可达性收口 seam，
// 以及 2 个 Desktop window/updater facade 初始化收口 seam、2 个 Managed Provider Core transport seam、
// 4 个 Library Core Protocol 调用面：
// Headless 主进程生命周期、Native DSD 扫描、Web 启动入口、main-session queue 投影、
// queue 权威态测试、移除 renderer 对播放索引/模式的重复持久化、Services 账户入口，
// 以及运行时 Settings 分类组装、stale 分类归一化、General Host section gating、About Host 信息投影
// 与 Appearance 本地背景图 Host capability gating；Core Download 使用既有 manager，
// 并收回源解析、任务歌词固化、Control projection 与 Core 路径 Host action gating，
// 同时删除旧 renderer resolution IPC 与 shared contract，避免保留 no-op 兼容协议；
// Core filesystem browser 则让 Library API/type/store/FolderManager 统一接收真实 Core 路径，
// 不再由 Web prompt 写入未经验证的主机路径字符串；Tag Editor 只隐藏 Control-local 封面 picker，
// Core 标签读写与在线封面写入仍保持 Web/Desktop 对等；Netease 的 Electron 登录窗口只在
// `providerLoginWindow` Host capability 下展示，Web 继续使用同一 Core QR/manual-cookie auth；Track action
// 语义集中到既有 `useTrackMenu`，SongList 的右键与 `...` 入口只投影同一模型；Collection
// header `...` 也复用同一 Action→menu adapter，而不创建第二 collection domain；Artist 的播放、收藏与
// overflow 同样由一个 action list 驱动；CoverCard/CoverList 只投影可选 action，Favorites 提供真实
// unsubscribe 语义，provider 调用仍留在 user store；FontConfig
// 在 Web 只保留手动 CSS font-family，不再把空 `listFonts()` 冒充系统字体枚举能力；DownloadList
// 隐藏无法从浏览器打开 Core 主机文件管理器的 action，歌词海报导出则在 Web 使用 browser download，
// 不再触发 Desktop `saveFile()` 的 unsupported facade；`useWindowControls` 与 updater store 也在 Host
// capability 不可用时停止 Desktop window/update API 初始化调用，避免不可见的 no-op facade 可达路径；
// Netease API wrapper 与手动 cookie dialog 则改走 shared Provider Core client，QQ/酷狗兼容 IPC 不扩权；
// Library 空状态、首页随机推荐/试试手气与本地歌手头像统一走 Library Core client，Desktop picker 只返回路径。
// NAPI/Vue 自动生成声明、Node Core runtime-neutral seam 与 Core-authority seam 单独报告，
// 不计入业务代码触点；两类架构 seam 仍各自有独立预算，避免借迁移无限扩大上游改动面。
const budget = Number(process.env.UPSTREAM_TOUCH_BUDGET || 75);
const runtimeSeamBudget = Number(process.env.UPSTREAM_RUNTIME_SEAM_BUDGET || 22);
const coreAuthoritySeamBudget = Number(process.env.UPSTREAM_CORE_AUTHORITY_SEAM_BUDGET || 13);
const metadataPaths = new Set([".gitignore", "AGENTS.md", "README.md", "README.zh-CN.md"]);
const generatedPaths = new Set(["native/audio-engine/index.d.ts", "components.d.ts"]);
const runtimeNeutralSeamPaths = new Set([
  "electron.vite.config.ts",
  "electron/main/apis/musicbrainz.ts",
  "electron/main/database/migration.ts",
  "electron/main/index.ts",
  "electron/main/ipc/cache.ts",
  "electron/main/plugins/host-process.ts",
  "electron/main/plugins/net.ts",
  "electron/main/plugins/registry.ts",
  "electron/main/server/routes.ts",
  "electron/main/services/device.ts",
  "electron/main/services/engine.ts",
  "electron/main/services/playerControl.ts",
  "electron/main/services/scanner.ts",
  "electron/main/services/songCache.ts",
  "electron/main/store/index.ts",
  "electron/main/utils/config.ts",
  "electron/main/utils/fetchBytes.ts",
  "electron/main/utils/logger.ts",
  "electron/main/utils/nativeLoader.ts",
  "electron/main/utils/paths.ts",
  "electron/main/utils/protocol.ts",
  "native/audio-engine/src/device_watcher/mod.rs",
]);
const coreAuthoritySeamPaths = new Set([
  "shared/defaults/settings.ts",
  "shared/types/settings.ts",
  "src/components/modals/FmModeDialog.vue",
  "src/components/player/QualityControl.vue",
  "src/settings/categories/other.ts",
  "src/settings/categories/player.ts",
  "src/services/autoClose.ts",
  "src/stores/settings.ts",
  "src/stores/user.ts",
  "src/types/netease.ts",
  "src/types/settings.ts",
  "src/utils/format/netease.ts",
  "src/utils/preset/djMode.ts",
]);

const git = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"],
  }).trim();

const lines = (text) => (text ? text.split("\n").filter(Boolean) : []);
const changed = new Set([
  ...lines(git(["diff", "--name-only", upstreamRef])),
  ...lines(git(["ls-files", "--others", "--exclude-standard"])),
]);

const existsInUpstream = (file) => {
  try {
    git(["cat-file", "-e", `${upstreamRef}:${file}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
};

const upstreamCodeTouches = [];
const upstreamRuntimeSeamTouches = [];
const upstreamCoreAuthoritySeamTouches = [];
const upstreamGeneratedTouches = [];
const downstreamMetadataTouches = [];
const atomOwnedAdditions = [];

for (const file of [...changed].sort()) {
  if (!existsInUpstream(file)) {
    atomOwnedAdditions.push(file);
  } else if (metadataPaths.has(file)) {
    downstreamMetadataTouches.push(file);
  } else if (generatedPaths.has(file)) {
    upstreamGeneratedTouches.push(file);
  } else if (runtimeNeutralSeamPaths.has(file)) {
    upstreamRuntimeSeamTouches.push(file);
  } else if (coreAuthoritySeamPaths.has(file)) {
    upstreamCoreAuthoritySeamTouches.push(file);
  } else {
    upstreamCodeTouches.push(file);
  }
}

const printGroup = (title, files) => {
  console.log(`\n${title}: ${files.length}`);
  for (const file of files) console.log(`  ${file}`);
};

console.log(`Upstream ref: ${upstreamRef}`);
console.log(`Upstream business-code touch budget: ${budget}`);
console.log(`Upstream runtime-neutral seam budget: ${runtimeSeamBudget}`);
console.log(`Upstream Core-authority seam budget: ${coreAuthoritySeamBudget}`);
printGroup("Upstream business-code touches", upstreamCodeTouches);
printGroup("Upstream runtime-neutral seam touches", upstreamRuntimeSeamTouches);
printGroup("Upstream Core-authority seam touches", upstreamCoreAuthoritySeamTouches);
printGroup("Upstream generated touches", upstreamGeneratedTouches);
printGroup("Downstream metadata touches", downstreamMetadataTouches);
printGroup("Atom-owned additions", atomOwnedAdditions);

if (upstreamCodeTouches.length > budget) {
  console.error(
    `\nUpstream business-code touch budget exceeded: ${upstreamCodeTouches.length} > ${budget}. Re-evaluate the integration seam.`,
  );
  process.exitCode = 1;
}

if (upstreamRuntimeSeamTouches.length > runtimeSeamBudget) {
  console.error(
    `\nUpstream runtime-neutral seam budget exceeded: ${upstreamRuntimeSeamTouches.length} > ${runtimeSeamBudget}. Re-evaluate the Core/Desktop boundary.`,
  );
  process.exitCode = 1;
}

if (upstreamCoreAuthoritySeamTouches.length > coreAuthoritySeamBudget) {
  console.error(
    `\nUpstream Core-authority seam budget exceeded: ${upstreamCoreAuthoritySeamTouches.length} > ${coreAuthoritySeamBudget}. Re-evaluate whether Control still owns playback policy.`,
  );
  process.exitCode = 1;
}
