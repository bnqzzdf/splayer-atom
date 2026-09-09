import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";
import { request } from "@/core/controlClient";
import ListenBrainzPanel from "@/components/settings/custom/ListenBrainzPanel.vue";
import IconLucideGlobe from "~icons/lucide/globe";

const servicesCategory: SettingCategory = {
  id: "services",
  icon: IconLucideGlobe,
  sections: [
    {
      id: "network",
      items: [
        {
          key: "networkProxyProtocol",
          type: "select",
          binding: { store: "settings", path: "system.system.networkProxy.protocol" },
          options: [
            { value: "off", labelKey: "settings.networkProxyProtocol.off" },
            { value: "http", labelKey: "settings.networkProxyProtocol.http" },
            { value: "https", labelKey: "settings.networkProxyProtocol.https" },
            { value: "socks5", labelKey: "settings.networkProxyProtocol.socks5" },
          ],
          defaultValue: "off",
          childrenCondition: () => useSettingsStore().system.system.networkProxy.protocol !== "off",
          children: [
            {
              key: "networkProxyHost",
              type: "text",
              binding: { store: "settings", path: "system.system.networkProxy.host" },
              defaultValue: "127.0.0.1",
              placeholderKey: "settings.networkProxyHost.placeholder",
              disabled: () => useSettingsStore().system.system.networkProxy.protocol === "off",
            },
            {
              key: "networkProxyPort",
              type: "number",
              binding: { store: "settings", path: "system.system.networkProxy.port" },
              min: 1,
              max: 65535,
              defaultValue: 7890,
              disabled: () => useSettingsStore().system.system.networkProxy.protocol === "off",
            },
            {
              key: "networkProxyTest",
              type: "button",
              action: async () => {
                const { t } = i18n.global;
                try {
                  const { ok } = await request<{ ok: boolean }>("/system/network-proxy/test", {
                    method: "POST",
                  });
                  if (ok) toast.success(t("settings.networkProxyTest.success"));
                  else toast.error(t("settings.networkProxyTest.failed"));
                } catch {
                  toast.error(t("settings.networkProxyTest.failed"));
                }
              },
            },
          ],
        },
        {
          key: "neteaseRealIp",
          type: "switch",
          binding: { store: "settings", path: "system.system.neteaseRealIp" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "listenbrainz",
      items: [
        {
          key: "listenbrainzEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.listenbrainz.enabled" },
          defaultValue: false,
          children: [
            {
              key: "listenbrainzAccount",
              type: "custom",
              component: ListenBrainzPanel,
              fullWidth: true,
              keywords: ["ListenBrainz", "Scrobble"],
            },
            {
              key: "listenbrainzNowPlaying",
              type: "switch",
              binding: { store: "settings", path: "system.listenbrainz.sendNowPlaying" },
              defaultValue: true,
            },
          ],
        },
      ],
    },
  ],
};

export default servicesCategory;
