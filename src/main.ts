import "@/services/client/webPolyfill";
import "virtual:uno.css";
import "@/styles/global.css";
import "@/web/runtime.css";

import piniaPersistedstate from "pinia-plugin-persistedstate";
import { vRipple } from "./directives/ripple";

const hasElectronApi = (): boolean =>
  typeof window !== "undefined" && "api" in window && typeof window.api === "object";

/** 挂载保留的 Headless 工程诊断页。 */
const mountDebugWeb = async (): Promise<void> => {
  const { default: HeadlessApp } = await import("./web/HeadlessApp.vue");
  const app = createApp(HeadlessApp);
  app.directive("ripple", vRipple);
  app.mount("#app");
};

/** 挂载同一套 SPlayer Atom UI；仅 transport/runtime 随 Desktop/Web 变化。 */
const mountSPlayer = async (webRemote: boolean): Promise<void> => {
  if (webRemote) {
    document.documentElement.dataset.atomRuntime = "web";
    const { installWebApi } = await import("./web/api");
    await installWebApi();
  } else {
    document.documentElement.dataset.atomRuntime = "desktop";
  }

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

  useThemeStore().init();

  watch(
    () => useSettingsStore().locale,
    (locale) => {
      i18n.global.locale.value = locale;
      window.api.system.setLocale(locale);
    },
    { immediate: true },
  );

  if (webRemote && router.currentRoute.value.path === "/") {
    await router.replace("/library");
  }
  await router.isReady();
  app.mount("#app");

  initPlayer().catch(console.error);

  if (!webRemote) {
    const [{ useHotkeyStore }, { installHotkeyManager }] = await Promise.all([
      import("./stores/hotkey"),
      import("./core/hotkey/manager"),
    ]);
    useHotkeyStore()
      .init()
      .then(installHotkeyManager)
      .catch((err) => console.error("[hotkey] init failed", err));
  }
};

const bootstrap = async (): Promise<void> => {
  if (hasElectronApi()) {
    await mountSPlayer(false);
    return;
  }
  if (window.location.pathname === "/debug") {
    await mountDebugWeb();
    return;
  }
  await mountSPlayer(true);
};

void bootstrap().catch((error) => {
  console.error("[bootstrap] failed", error);
});
