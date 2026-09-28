import type { SettingCategory, SettingSection } from "@/types/settings-schema";
import appearanceCategory from "./categories/appearance";
import playerCategory from "./categories/player";
import lyricCategory from "./categories/lyric";
import localLibraryCategory from "./categories/localLibrary";
import servicesCategory from "./categories/services";
import mediaSourceCategory from "./categories/streaming";
import downloadCategory from "./categories/download";
import localCacheCategory from "./categories/localCache";
import pluginsCategory from "./categories/plugins";
import otherCategory from "./categories/other";
import AboutSettings from "@/components/settings/custom/AboutSettings.vue";
import PlatformAccount from "@/components/settings/custom/PlatformAccount.vue";
import IconLucideInfo from "~icons/lucide/info";

const providerAccountsSection: SettingSection = {
  id: "providerAccounts",
  items: [
    {
      key: "neteaseAccount",
      type: "custom",
      component: PlatformAccount,
      componentProps: { platform: "netease" },
      fullWidth: true,
      keywords: [
        "NCM",
        "网易云",
        "网易云音乐",
        "settings.platformLogin.loginQr",
        "settings.platformLogin.manualCookie",
      ],
    },
    {
      key: "qqmusicAccount",
      type: "custom",
      component: PlatformAccount,
      componentProps: { platform: "qqmusic" },
      fullWidth: true,
      keywords: [
        "QM",
        "QQ音乐",
        "settings.platformLogin.loginQr",
        "settings.platformLogin.manualCookie",
      ],
    },
    {
      key: "kugouAccount",
      type: "custom",
      component: PlatformAccount,
      componentProps: { platform: "kugou" },
      fullWidth: true,
      keywords: [
        "KG",
        "酷狗",
        "settings.platformLogin.loginQr",
        "settings.platformLogin.manualCookie",
      ],
    },
    {
      key: "qobuzAccount",
      type: "custom",
      component: PlatformAccount,
      componentProps: { platform: "qobuz" },
      fullWidth: true,
      keywords: ["Qobuz", "settings.platformLogin.connect"],
    },
    {
      key: "tidalAccount",
      type: "custom",
      component: PlatformAccount,
      componentProps: { platform: "tidal" },
      fullWidth: true,
      keywords: ["TIDAL", "settings.platformLogin.connect"],
    },
  ],
};

const controlServicesCategory: SettingCategory = {
  ...servicesCategory,
  sections: (servicesCategory.sections ?? []).flatMap((section) =>
    section.id === "network" ? [section, providerAccountsSection] : [section],
  ),
};

export const settingsSchema: SettingCategory[] = [
  appearanceCategory,
  playerCategory,
  lyricCategory,
  localLibraryCategory,
  controlServicesCategory,
  mediaSourceCategory,
  downloadCategory,
  localCacheCategory,
  pluginsCategory,
  otherCategory,
  { id: "about", icon: IconLucideInfo, component: AboutSettings },
];
