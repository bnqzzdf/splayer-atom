import type { Configuration } from "electron-builder";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const atomCommit =
  process.env.ATOM_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const atomSourceDirty =
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim().length > 0;
const splayerBaseline = (
  JSON.parse(readFileSync("scripts/atom/upstream.json", "utf8")) as { acceptedBaseline?: string }
).acceptedBaseline;
if (!atomCommit || !splayerBaseline)
  throw new Error("缺少 Atom commit 或 SPlayer baseline release metadata");
const prereleaseChannel = /-(beta)(?:\.|$)/.exec(packageVersion)?.[1];
const inferredReleaseChannel = prereleaseChannel ?? "stable";
const releaseChannel = process.env.UPDATE_CHANNEL ?? inferredReleaseChannel;
const headlessBuild = process.env.HEADLESS_BUILD === "1";

if (releaseChannel !== "stable" && releaseChannel !== "beta") {
  throw new Error(`不支持的更新通道: ${releaseChannel}`);
}
if (packageVersion.includes("-") && !prereleaseChannel) {
  throw new Error(`不支持的预发布版本格式: ${packageVersion}`);
}
if (releaseChannel !== inferredReleaseChannel) {
  throw new Error(`版本 ${packageVersion} 与更新通道 ${releaseChannel} 不匹配`);
}
const publishChannel = releaseChannel === "stable" ? "latest" : "beta";

const config: Configuration = {
  appId: "io.github.bnqzzdf.splayer-atom",
  productName: "SPlayer Atom",
  copyright: "Copyright © SPlayer contributors and SPlayer Atom contributors",
  directories: { buildResources: "public" },
  extraMetadata: { atomCommit, atomSourceDirty, splayerBaseline },
  afterPack: "./scripts/after-pack.ts",
  compression: "maximum",
  generateUpdatesFilesForAllChannels: true,
  files: [
    "public/**",
    "out/**",
    "!**/.vscode/*",
    "!src/**",
    "!native/**",
    "!scripts/**",
    "!electron/**",
    "!shared/**",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!electron-builder.config.{js,ts,mjs,cjs}",
    "!uno.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,auto-eslint.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{components.d.ts,auto-imports.d.ts}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!**/*.{d.ts,ts,map,md}",
    "!**/{CHANGELOG,README,readme}*",
    "!**/node_modules/better-sqlite3/{deps,src}/**",
  ],
  // 保留的语言
  electronLanguages: ["zh-CN", "en-US"],
  asarUnpack: ["public/**"],
  extraResources: [
    {
      from: "native/audio-engine",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/audio-capture",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "resources/afp",
      to: "afp",
      filter: ["afp.mjs", "afp.wasm.mjs"],
    },
    {
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-lyric",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-thumbnail",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/opencc",
      to: "native",
      filter: ["*.node"],
    },
  ],
  win: {
    executableName: "splayer-atom",
    icon: "public/icons/logo.ico",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    forceCodeSigning: false,
    target: ["nsis", "portable"],
  },
  nsis: {
    oneClick: false,
    guid: "io.github.bnqzzdf.splayer-atom",
    installerIcon: "public/icons/favicon.ico",
    uninstallerIcon: "public/icons/favicon.ico",
    artifactName: "${productName}-${version}-${arch}-setup.${ext}",
    shortcutName: "SPlayer Atom",
    uninstallDisplayName: "SPlayer Atom",
    createDesktopShortcut: "always",
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    license: "build/license.txt",
  },
  portable: {
    artifactName: "${productName}-${version}-${arch}-portable.${ext}",
  },
  mac: {
    executableName: "splayer-atom",
    icon: "public/icons/icon.icns",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    darkModeSupport: true,
    category: "public.app-category.music",
    entitlementsInherit: "public/entitlements.mac.plist",
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
    },
    target: ["dmg", "zip"],
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: {
    executableName: "splayer-atom",
    icon: "public/icons/favicon-512x512.png",
    artifactName: "${name}-${version}-${arch}.${ext}",
    maintainer: "imsyy.top",
    category: "Audio;Music;AudioVideo;",
    target: ["tar.gz"],
    syncDesktopName: true,
    ...(headlessBuild
      ? {
          desktop: {
            entry: {
              Type: "Application",
              Terminal: true,
              Exec: "${executable} --headless",
              Categories: "Audio;Music;AudioVideo;",
            },
          },
        }
      : {}),
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  pacman: {
    artifactName: "${name}-${version}-${arch}.${ext}",
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libxss",
      "libxtst",
      "xdg-utils",
      "at-spi2-core",
      "libsecret",
    ],
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: {
    provider: "github",
    owner: "bnqzzdf",
    repo: "splayer-atom",
    channel: publishChannel,
  },
};

export default config;
