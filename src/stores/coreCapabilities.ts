import type { CoreCapabilities } from "@shared/types/core";
import type { ManagedProviderPlatform } from "@shared/types/apis";
import { getCoreInfo } from "@/core/controlClient";

/**
 * Core 域能力投影。
 *
 * 渲染端不假设「编译进来的平台一定存在」：一个不含某平台的 Core 会在
 * `GET /api/info` 的 `capabilities` 里把该平台的位设为 false，本 store 据此
 * 让产品面（搜索平台 tab 等）跟着隐藏，而不是留一个必然报错的入口。
 *
 * 默认值取**宽松**集合：只有在真正读到 Core 能力位之后才会收窄，避免一次
 * 探测失败就把所有在线平台从界面上抹掉。
 */
const PERMISSIVE_FALLBACK: CoreCapabilities = {
  library: true,
  playback: true,
  download: true,
  diretta: false,
  netease: true,
  qqmusic: true,
  kugou: true,
  qobuz: true,
  tidal: true,
  remoteOutput: false,
};

/** Control 侧只投影 Core 声明的能力，不持久化、不推断。 */
export const useCoreCapabilitiesStore = defineStore("coreCapabilities", () => {
  const capabilities = ref<CoreCapabilities>({ ...PERMISSIVE_FALLBACK });
  /** 是否已成功读到一份真实的能力位（失败时保持宽松默认）。 */
  const initialized = ref(false);

  const refresh = async (): Promise<void> => {
    try {
      const info = await getCoreInfo();
      capabilities.value = info.capabilities;
      initialized.value = true;
    } catch (error) {
      console.warn("[core-capabilities] fetch failed, keeping permissive defaults", error);
    }
  };

  /** 该托管平台是否被当前 Core 声明为可用。 */
  const supportsPlatform = (platform: ManagedProviderPlatform): boolean =>
    capabilities.value[platform] !== false;

  void refresh();

  return { capabilities, initialized, refresh, supportsPlatform };
});
