import "virtual:uno.css";
import "@/styles/global.css";
import "@/web/runtime.css";

import piniaPersistedstate from "pinia-plugin-persistedstate";
import { vRipple } from "./directives/ripple";

/** 挂载工程诊断页。 */
const mountDebugWeb = async (): Promise<void> => {
  const { default: HeadlessApp } = await import("./web/HeadlessApp.vue");
  const app = createApp(HeadlessApp);
  app.directive("ripple", vRipple);
  app.mount("#app");
};

/** 挂载唯一 Web Control。 */
const mountWebControl = async (): Promise<void> => {
  const [
    { default: App },
    { default: router },
    { default: i18n },
    { useThemeStore },
    { useSettingsStore },
    { initPlayer },
  ] = await Promise.all([
    import("./App.vue"),
    import("./router"),
    import("./i18n"),
    import("./stores/theme"),
    import("./stores/settings"),
    import("./core/player"),
  ]);

  const pinia = createPinia();
  pinia.use(piniaPersistedstate);

  const app = createApp(App);
  app.directive("ripple", vRipple);
  app.use(pinia);
  app.use(router);
  app.use(i18n);

  await useSettingsStore().syncSystem();
  useThemeStore().init();

  watch(
    () => useSettingsStore().locale,
    (locale) => {
      i18n.global.locale.value = locale;
    },
    { immediate: true },
  );

  if (router.currentRoute.value.path === "/") await router.replace("/library");
  await router.isReady();
  app.mount("#app");
  initPlayer().catch(console.error);
};

const bootstrap = async (): Promise<void> => {
  if (window.location.pathname === "/debug") {
    await mountDebugWeb();
    return;
  }
  await mountWebControl();
};

void bootstrap().catch((error) => {
  console.error("[bootstrap] failed", error);
});
