import type { SystemConfig } from "../types/settings";
import { defaultPluginsConfig } from "./plugin-api";

/** 默认配置 */
export const defaultSystemConfig: SystemConfig = {
  player: {
    autoPlay: false,
    rememberLastTrack: true,
    fadeEnabled: true,
    fadeDuration: 200,
    outputDevice: null,
    volume: 1,
    songLevel: "hq",
    allowTrialPlay: false,
    preloadNextTrack: false,
    pauseOnDeviceSwitch: false,
    fuckDjMode: false,
    loudnessNormalization: false,
    equalizer: {
      enabled: false,
      preset: "flat",
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preamp: 0,
    },
    lyricOffsets: {},
  },
  library: {
    scanDirs: [],
  },
  lyric: {
    enableOnlineTTMLLyric: false,
    amllDbServer: "https://amlldb.bikonoo.com/%p/%s.ttml",
  },
  localLyric: {
    enableLocalTTMLOverride: false,
    repoDir: "",
  },
  cache: {
    dir: null,
    songCache: {
      enabled: false,
      cacheStreaming: false,
      sizeLimitGb: 10,
    },
  },
  download: {
    enabled: false,
    dir: null,
    quality: "lossless",
    usePlaybackForDownload: false,
    fileTemplate: "{title}",
    folderScheme: "album",
    overwritePolicy: "rename",
    embedCover: true,
    embedMeta: true,
    embedLyric: true,
    writeLrc: false,
    saveTtml: false,
    lyricFileFormat: "enhanced-lrc",
  },
  streaming: {
    enabled: true,
  },
  listenbrainz: {
    enabled: false,
    sendNowPlaying: true,
  },
  system: {
    uiZoom: 100,
    onboardingCompleted: false,
    neteaseRealIp: false,
    kugouLoginVersion: "standard",
    networkProxy: {
      protocol: "off",
      host: "127.0.0.1",
      port: 7890,
    },
    neteaseScrobbleEnabled: false,
    neteaseScrobbleMode: "ncbl",
  },
  plugins: defaultPluginsConfig,
};
