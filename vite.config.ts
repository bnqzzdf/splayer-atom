import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import UnoCSS from "unocss/vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import { FileSystemIconLoader } from "unplugin-icons/loaders";
import RekaResolver from "reka-ui/resolver";
import Components from "unplugin-vue-components/vite";
import pkg from "./package.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));

const getGitCommit = (): string => {
  try {
    return execSync("git rev-parse HEAD").toString().trim().slice(0, 7) || "unknown";
  } catch {
    return "unknown";
  }
};

const getGitDate = (): string => {
  try {
    return execSync("git log -1 --format=%cI").toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
};

/** SPlayer Atom 唯一 Web Control 构建配置。 */
export default defineConfig({
  root,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_REPO_URL__: JSON.stringify(pkg.repository.url),
    __APP_REPO_NAME__: JSON.stringify(pkg.productName),
    __APP_AUTHOR__: JSON.stringify(pkg.author.name),
    __APP_HOMEPAGE__: JSON.stringify(pkg.homepage),
    __APP_AUTHOR_URL__: JSON.stringify(pkg.author.url),
    __COMMIT_HASH__: JSON.stringify(getGitCommit()),
    __COMMIT_DATE__: JSON.stringify(getGitDate()),
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:14558",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_WS_PROXY ?? "ws://127.0.0.1:14558",
        ws: true,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/native/**/target/**"],
    },
  },
  publicDir: resolve(root, "public"),
  build: {
    outDir: resolve(root, "out", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(root, "src"),
      "@shared": resolve(root, "shared"),
      "@root": root,
    },
  },
  plugins: [
    vue(),
    UnoCSS(),
    AutoImport({
      imports: ["vue", "pinia", "vue-router", "@vueuse/core", "vue-i18n"],
      eslintrc: {
        enabled: true,
        filepath: "./auto-eslint.mjs",
      },
    }),
    Icons({
      compiler: "vue3",
      scale: 1,
      customCollections: {
        sp: FileSystemIconLoader("./src/assets/icons"),
      },
    }),
    Components({
      dirs: ["src/components"],
      resolvers: [RekaResolver(), IconsResolver({ prefix: "icon", customCollections: ["sp"] })],
    }),
  ],
});
