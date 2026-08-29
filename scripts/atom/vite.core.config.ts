import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      "@main": resolve(root, "electron/main"),
      "@shared": resolve(root, "shared"),
      "electron-log": resolve(root, "node_modules/electron-log/node.js"),
      "@splayer/audio-engine": resolve(root, "native/audio-engine"),
      "@splayer/audio-capture": resolve(root, "native/audio-capture"),
      "@splayer/media-ctrl": resolve(root, "native/media-ctrl"),
      "@splayer/taskbar-lyric": resolve(root, "native/taskbar-lyric"),
      "@splayer/taskbar-thumbnail": resolve(root, "native/taskbar-thumbnail"),
      "@splayer/opencc": resolve(root, "native/opencc"),
    },
  },
  ssr: {
    external: ["better-sqlite3"],
    noExternal: [
      "@hono/node-server",
      "atomically",
      "electron-log",
      "fast-xml-parser",
      "hono",
      "undici",
      "ws",
    ],
  },
  build: {
    ssr: true,
    target: "node24",
    outDir: resolve(root, "out/core"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(root, "electron/main/core-node/index.ts"),
        "plugin-host": resolve(root, "electron/main/atom/pluginHostNode.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
  },
});
