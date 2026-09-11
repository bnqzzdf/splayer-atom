import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DIRETTA_SDK_RELEASE,
  parseDirettaCpuVariant,
  readDirettaSdkRelease,
  type DirettaCpuVariant,
} from "./diretta-sdk";

const root = fileURLToPath(new URL("../..", import.meta.url));
const audioCrateDir = path.join(root, "native", "audio-engine");
const streamingCrateDir = path.join(root, "native", "streaming-api");
const outputDir = path.join(root, "out", "native");
const targetDir = path.join(root, "target", "core-audio");
const napiBin = path.join(root, "node_modules", ".bin", "napi");

const cargoBinDir = path.join(
  process.env.CARGO_HOME?.trim() || path.join(os.homedir(), ".cargo"),
  "bin",
);
const args = new Set(process.argv.slice(2));
const isDev = args.delete("--dev");
const requireDiretta = args.delete("--require-diretta");
const direttaVariantArg = [...args].find((arg) => arg.startsWith("--diretta-variant="));
if (direttaVariantArg) args.delete(direttaVariantArg);
if (args.size > 0) {
  throw new Error(`未知 Core native 构建参数: ${[...args].join(" ")}`);
}
if (process.platform !== "linux") {
  throw new Error("Core native flavor 当前只支持 Linux");
}
const direttaSdkRoot = process.env.DIRETTA_SDK_ROOT?.trim() || null;
if (requireDiretta && !direttaSdkRoot) {
  throw new Error("正式 Diretta Core 构建要求设置 DIRETTA_SDK_ROOT");
}
const direttaVariantValue =
  direttaVariantArg?.slice("--diretta-variant=".length) ||
  process.env.DIRETTA_CPU_VARIANT?.trim() ||
  null;
const direttaCpuVariant: DirettaCpuVariant | null = direttaSdkRoot
  ? direttaVariantValue
    ? parseDirettaCpuVariant(direttaVariantValue)
    : null
  : null;
if (direttaSdkRoot && !direttaCpuVariant) {
  throw new Error("Diretta Core 构建要求指定 --diretta-variant=v2|v3|v4");
}
const direttaSdkRelease = direttaSdkRoot ? readDirettaSdkRelease(direttaSdkRoot) : null;
if (direttaSdkRelease !== null && direttaSdkRelease !== DIRETTA_SDK_RELEASE) {
  throw new Error(
    `Core Diretta 构建固定使用 SDK ${DIRETTA_SDK_RELEASE}，当前为 ${direttaSdkRelease}`,
  );
}

const childEnv = {
  ...process.env,
  PATH: [process.env.PATH, cargoBinDir].filter(Boolean).join(path.delimiter),
  ...(direttaCpuVariant ? { DIRETTA_CPU_VARIANT: direttaCpuVariant } : {}),
};

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const runNapiBuild = (label: string, cwd: string, buildArgs: string[]): void => {
  console.log(`[CoreNative] 构建 ${label} (${isDev ? "debug" : "release"})`);
  const result = spawnSync(napiBin, buildArgs, {
    cwd,
    env: childEnv,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} 构建被信号终止: ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} 构建失败: ${result.status ?? "unknown"}`);
};

const commonArgs = [
  "build",
  "--no-const-enum",
  "--target-dir",
  targetDir,
  "--output-dir",
  outputDir,
];
if (!isDev) commonArgs.push("--release");

const audioFeatures = direttaSdkRoot ? "core-audio,diretta" : "core-audio";
runNapiBuild(
  `audio-engine (ALSA-only${direttaSdkRoot ? `, Diretta ${direttaCpuVariant}` : ""})`,
  audioCrateDir,
  [...commonArgs, "--no-default-features", "--features", audioFeatures],
);
runNapiBuild("streaming-api (Qobuz/TIDAL)", streamingCrateDir, commonArgs);

const audioAddonPath = path.join(outputDir, "audio-engine.node");
const streamingAddonPath = path.join(outputDir, "streaming-api.node");
for (const addonPath of [audioAddonPath, streamingAddonPath]) {
  if (!existsSync(addonPath)) {
    throw new Error(`Core native addon 未生成: ${addonPath}`);
  }
}

writeFileSync(
  path.join(outputDir, "build.json"),
  `${JSON.stringify(
    {
      profile: isDev ? "debug" : "release",
      flavor: "core-audio",
      modules: ["audio-engine", "streaming-api"],
      platform: process.platform,
      arch: process.arch,
      diretta: direttaSdkRoot !== null,
      direttaSdkRelease,
      direttaCpuVariant,
    },
    null,
    2,
  )}\n`,
);

const ldd = spawnSync("ldd", [audioAddonPath], { encoding: "utf8" });
if (ldd.error) throw ldd.error;
if (ldd.status !== 0) throw new Error(`ldd 检查失败: ${ldd.stderr || ldd.stdout}`);
const dynamicDeps = `${ldd.stdout}\n${ldd.stderr}`;
if (/lib(?:pipewire|pulse)/i.test(dynamicDeps)) {
  throw new Error("Core audio-engine 仍携带 PipeWire/PulseAudio 动态依赖");
}

console.log(`[CoreNative] PASS ${audioAddonPath}`);
console.log(`[CoreNative] PASS ${streamingAddonPath}`);
