import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DIRETTA_SDK_RELEASE, readDirettaSdkRelease } from "./diretta-sdk";

const root = fileURLToPath(new URL("../..", import.meta.url));
const crateDir = path.join(root, "native", "audio-engine");
const outputDir = path.join(root, "out", "native");
const targetDir = path.join(root, "target", "core-audio");
const napiBin = path.join(root, "node_modules", ".bin", "napi");

const cargoBinDir = path.join(
  process.env.CARGO_HOME?.trim() || path.join(os.homedir(), ".cargo"),
  "bin",
);
const childEnv = {
  ...process.env,
  PATH: [process.env.PATH, cargoBinDir].filter(Boolean).join(path.delimiter),
};

const args = new Set(process.argv.slice(2));
const isDev = args.delete("--dev");
const requireDiretta = args.delete("--require-diretta");
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
const direttaSdkRelease = direttaSdkRoot ? readDirettaSdkRelease(direttaSdkRoot) : null;
if (direttaSdkRelease !== null && direttaSdkRelease !== DIRETTA_SDK_RELEASE) {
  throw new Error(
    `Core Diretta 构建固定使用 SDK ${DIRETTA_SDK_RELEASE}，当前为 ${direttaSdkRelease}`,
  );
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const napiArgs = [
  "build",
  "--no-const-enum",
  "--no-default-features",
  "--features",
  "core-audio",
  "--target-dir",
  targetDir,
  "--output-dir",
  outputDir,
];
if (!isDev) napiArgs.push("--release");

console.log(`[CoreNative] 构建 audio-engine (${isDev ? "debug" : "release"}, ALSA-only)`);
const build = spawnSync(napiBin, napiArgs, {
  cwd: crateDir,
  env: childEnv,
  stdio: "inherit",
  shell: false,
});
if (build.error) throw build.error;
if (build.signal) throw new Error(`Core native 构建被信号终止: ${build.signal}`);
if (build.status !== 0) throw new Error(`Core native 构建失败: ${build.status ?? "unknown"}`);

const addonPath = path.join(outputDir, "audio-engine.node");
if (!existsSync(addonPath)) {
  throw new Error(`Core native addon 未生成: ${addonPath}`);
}
writeFileSync(
  path.join(outputDir, "build.json"),
  `${JSON.stringify(
    {
      profile: isDev ? "debug" : "release",
      flavor: "core-audio",
      platform: process.platform,
      arch: process.arch,
      diretta: direttaSdkRoot !== null,
      direttaSdkRelease,
    },
    null,
    2,
  )}\n`,
);

const ldd = spawnSync("ldd", [addonPath], { encoding: "utf8" });
if (ldd.error) throw ldd.error;
if (ldd.status !== 0) throw new Error(`ldd 检查失败: ${ldd.stderr || ldd.stdout}`);
const dynamicDeps = `${ldd.stdout}\n${ldd.stderr}`;
if (/lib(?:pipewire|pulse)/i.test(dynamicDeps)) {
  throw new Error("Core audio-engine 仍携带 PipeWire/PulseAudio 动态依赖");
}

console.log(`[CoreNative] PASS ${addonPath}`);
