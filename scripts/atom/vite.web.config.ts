import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type UserConfig } from "vite";

process.env.ATOM_CORE_WEB_BUILD = "1";
const { default: electronConfig } = await import("../../electron.vite.config");

const root = fileURLToPath(new URL("../..", import.meta.url));
const renderer = (electronConfig as { renderer: UserConfig }).renderer;

/** Core Web Control 复用 Desktop renderer 配置，但只构建主 Web 入口。 */
export default defineConfig({
  ...renderer,
  build: {
    ...renderer.build,
    outDir: resolve(root, "out", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      ...renderer.build?.rollupOptions,
      input: {
        index: resolve(root, "index.html"),
      },
    },
  },
});
