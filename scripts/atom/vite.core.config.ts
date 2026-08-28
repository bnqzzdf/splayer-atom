import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@main": resolve(root, "electron/main"),
      "@shared": resolve(root, "shared"),
      "@splayer/audio-engine": resolve(root, "native/audio-engine"),
      "@splayer/audio-capture": resolve(root, "native/audio-capture"),
      "@splayer/media-ctrl": resolve(root, "native/media-ctrl"),
      "@splayer/taskbar-lyric": resolve(root, "native/taskbar-lyric"),
      "@splayer/taskbar-thumbnail": resolve(root, "native/taskbar-thumbnail"),
      "@splayer/opencc": resolve(root, "native/opencc"),
    },
  },
  build: {
    ssr: resolve(root, "electron/main/core-node/index.ts"),
    target: "node22",
    outDir: resolve(root, "out/core"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "index.js",
      },
    },
  },
});
