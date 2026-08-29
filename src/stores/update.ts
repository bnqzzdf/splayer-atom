import type { UpdateEvent, UpdateMeta, UpdatePhase } from "@shared/types/update";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";
import { hasHostCapability } from "@/runtime";

const { t } = i18n.global;

export const useUpdateStore = defineStore("update", () => {
  /** 当前阶段 */
  const phase = ref<UpdatePhase>("idle");
  /** 更新信息（版本 / 日志 / 日期 / 大小） */
  const meta = ref<UpdateMeta | null>(null);
  /** 下载进度 0–100 */
  const percent = ref(0);
  /** 当前平台是否支持应用内安装 */
  const canInstall = ref(true);
  /** 更新弹窗开关 */
  const dialogOpen = ref(false);

  /** 是否有可用更新（驱动顶栏图标） */
  const hasUpdate = computed(() =>
    ["available", "downloading", "downloaded"].includes(phase.value),
  );

  const handleEvent = (event: UpdateEvent): void => {
    switch (event.type) {
      case "checking":
        phase.value = "checking";
        break;
      case "available":
        phase.value = "available";
        meta.value = event.meta;
        canInstall.value = event.canInstall;
        percent.value = 0;
        dialogOpen.value = true;
        break;
      case "notAvailable":
        phase.value = "upToDate";
        if (event.manual) toast.success(t("update.upToDate"));
        break;
      case "progress":
        phase.value = "downloading";
        percent.value = event.percent;
        break;
      case "downloaded":
        phase.value = "downloaded";
        meta.value = event.meta;
        toast.success(t("update.readyToast"));
        break;
      case "error":
        phase.value = "error";
        if (event.manual) toast.error(t("update.failed"));
        break;
    }
  };

  const updaterAvailable = hasHostCapability("desktopUpdater");
  // Desktop updater 是 Host capability；Web 只保留 API shape，不触发 no-op facade。
  const unsubscribe = updaterAvailable ? window.api.update.onEvent(handleEvent) : null;
  if (unsubscribe) onScopeDispose(unsubscribe);
  if (updaterAvailable) void window.api.update.check(false);

  /** 手动检查更新 */
  const checkManually = (): void => {
    if (!updaterAvailable) return;
    phase.value = "checking";
    void window.api.update.check(true);
  };

  /** 下载更新 */
  const download = (): void => {
    if (!updaterAvailable) return;
    phase.value = "downloading";
    percent.value = 0;
    void window.api.update.download();
  };

  /** 退出并安装 */
  const install = (): void => {
    if (updaterAvailable) void window.api.update.install();
  };

  /** 打开 Releases 下载页（mac） */
  const openDownloadPage = (): void => {
    if (updaterAvailable) void window.api.update.openDownloadPage();
  };

  /** 打开更新弹窗 */
  const openDialog = (): void => {
    dialogOpen.value = true;
  };

  return {
    phase,
    meta,
    percent,
    canInstall,
    dialogOpen,
    hasUpdate,
    checkManually,
    download,
    install,
    openDownloadPage,
    openDialog,
  };
});
