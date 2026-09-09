import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      "@main": resolve(root, "core"),
      "@shared": resolve(root, "shared"),
      "@splayer/audio-engine": resolve(root, "native/audio-engine"),
    },
  },
  ssr: {
    external: ["better-sqlite3"],
    noExternal: ["@hono/node-server", "atomically", "fast-xml-parser", "hono", "undici", "ws"],
  },
  build: {
    ssr: true,
    target: "node24",
    outDir: resolve(root, "out/core"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(root, "core/core-node/index.ts"),
        "plugin-host": resolve(root, "core/atom/pluginHostNode.ts"),
        "listenbrainz-child": resolve(root, "core/services/listenbrainzChild.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
  },
});
