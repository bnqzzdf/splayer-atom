import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_REPO_URL__: JSON.stringify(pkg.repository.url),
    __APP_REPO_NAME__: JSON.stringify(pkg.productName),
    __APP_AUTHOR__: JSON.stringify(pkg.author.name),
    __APP_HOMEPAGE__: JSON.stringify(pkg.homepage),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@root": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  plugins: [
    vue(),
    Icons({ compiler: "vue3" }),
    AutoImport({
      imports: ["vue", "pinia", "vue-router", "@vueuse/core", "vue-i18n"],
    }),
  ],
  test: {
    environment: "happy-dom",
    // Node 25+ 默认在 globalThis 挂载未启用时返回 undefined 的 Web Storage getter，导致 Vitest populateGlobal 跳过 happy-dom 的 localStorage。
    execArgv: ["--no-experimental-webstorage"],
    include: ["src/**/*.spec.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
