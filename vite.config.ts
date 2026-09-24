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
import { resolveSourceIdentity } from "./scripts/atom/sourceIdentity";

const root = fileURLToPath(new URL(".", import.meta.url));

// 与 stage-core-system.ts 共用同一条身份回退链（git → ATOM_COMMIT → SOURCE_COMMIT），
// 这样源码交付包在无 .git 环境下构建时，Web 侧显示的 commit / 日期也不会变成 unknown。
const sourceIdentity = resolveSourceIdentity(root);

// 注入完整提交号，截断统一交给展示层（`@/utils/commit` 的 shortCommit）。
// 这样界面显示的短号与复制出的诊断信息用的是同一个原始值，不会各截各的。
const getGitCommit = (): string => sourceIdentity?.commit ?? "unknown";

const getGitDate = (): string => sourceIdentity?.date ?? "unknown";

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
