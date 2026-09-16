import type { SettingCategory } from "@/types/settings-schema";
import LocalLibrarySettings from "@/components/settings/custom/LocalLibrarySettings.vue";
import IconLucideLibraryBig from "~icons/lucide/library-big";

const localLibraryCategory: SettingCategory = {
  id: "localLibrary",
  icon: IconLucideLibraryBig,
  component: LocalLibrarySettings,
};

export default localLibraryCategory;
