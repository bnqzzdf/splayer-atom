import type { SettingCategory, SettingSection } from "@/types/settings-schema";
import { hasHostCapability, isDesktopRenderer } from "@/runtime";
import generalCategory from "./categories/general";
import appearanceCategory from "./categories/appearance";
import playerCategory from "./categories/player";
import lyricCategory from "./categories/lyric";
import externalLyricCategory from "./categories/externalLyric";
import hotkeysCategory from "./categories/hotkeys";
import servicesCategory from "./categories/services";
import aiIntegrationCategory from "./categories/aiIntegration";
import mediaSourceCategory from "./categories/streaming";
import downloadCategory from "./categories/download";
import localCacheCategory from "./categories/localCache";
import pluginsCategory from "./categories/plugins";
import otherCategory from "./categories/other";
import AboutSettings from "@/components/settings/custom/AboutSettings.vue";
import ProviderAccounts from "@/components/settings/custom/ProviderAccounts.vue";
import IconLucideInfo from "~icons/lucide/info";

const controlGeneralCategory: SettingCategory = {
  ...generalCategory,
  sections: generalCategory.sections?.filter((section) => {
    if (section.id === "systemConfig") return hasHostCapability("windowControls");
    if (section.id === "update") return hasHostCapability("desktopUpdater");
    if (section.id === "backupReset") return hasHostCapability("nativeFileDialogs");
    return true;
  }),
};

const controlAppearanceCategory: SettingCategory = {
  ...appearanceCategory,
  sections: appearanceCategory.sections?.filter(
    (section) => section.id !== "appearanceStyle" || hasHostCapability("nativeFileDialogs"),
  ),
};

const controlLyricCategory: SettingCategory = hasHostCapability("nativeCjkTransform")
  ? lyricCategory
  : {
      ...lyricCategory,
      sections: lyricCategory.sections?.map((section) => ({
        ...section,
        items: section.items.filter((item) => item.key !== "cjkTransform"),
      })),
    };

const providerAccountsSection: SettingSection = {
  id: "providerAccounts",
  items: [
    {
      key: "providerAccounts",
      type: "custom",
      component: ProviderAccounts,
      fullWidth: true,
      keywords: ["Qobuz", "TIDAL"],
    },
  ],
};

const desktopOnlyServiceSections = new Set(["media", "discord", "lastfm", "externalApi"]);
const controlServicesCategory: SettingCategory = {
  ...servicesCategory,
  sections: (servicesCategory.sections ?? [])
    .flatMap((section) =>
      section.id === "lastfm" ? [providerAccountsSection, section] : [section],
    )
    .filter((section) => isDesktopRenderer() || !desktopOnlyServiceSections.has(section.id)),
};

const controlPluginsCategory: SettingCategory = isDesktopRenderer()
  ? pluginsCategory
  : {
      ...pluginsCategory,
      sections: pluginsCategory.sections?.filter((section) => section.id !== "pluginManage"),
    };

export const settingsSchema: SettingCategory[] = [
  controlGeneralCategory,
  controlAppearanceCategory,
  playerCategory,
  controlLyricCategory,
  ...(hasHostCapability("desktopLyric") ? [externalLyricCategory] : []),
  ...(hasHostCapability("globalHotkeys") ? [hotkeysCategory] : []),
  controlServicesCategory,
  ...(isDesktopRenderer() ? [aiIntegrationCategory] : []),
  mediaSourceCategory,
  downloadCategory,
  localCacheCategory,
  controlPluginsCategory,
  otherCategory,
  { id: "about", icon: IconLucideInfo, component: AboutSettings },
];
