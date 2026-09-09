import type { SettingCategory } from "@/types/settings-schema";
import { LOCALES } from "@shared/types/settings";
import IconLucideCog from "~icons/lucide/cog";

const generalCategory: SettingCategory = {
  id: "general",
  icon: IconLucideCog,
  sections: [
    {
      id: "language",
      items: [
        {
          key: "language",
          type: "select",
          binding: { store: "settings", path: "locale" },
          options: LOCALES.map(({ value, label }) => ({ value, label })),
          defaultValue: "zh-CN",
        },
      ],
    },
    {
      id: "debug",
      items: [
        {
          key: "showPerformanceMonitor",
          type: "switch",
          binding: { store: "settings", path: "appearance.showPerformanceMonitor" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default generalCategory;
